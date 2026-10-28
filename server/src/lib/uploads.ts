import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { fileTypeFromBuffer } from 'file-type';
import type { DocumentKind } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { prisma } from './db.js';
import { AppError, badRequest } from './errors.js';
import { storage } from './storage.js';

/*
 * Uploads are streamed part by part to private temporary files (never buffered in memory), checked by their bytes, and
 * moved into storage only once the request is accepted. Limits:
 *  - per file UPLOAD_MAX_FILE_MB, at most MAX_FILES files, MAX_FIELDS fields (also enforced by @fastify/multipart);
 *  - a request whose Content-Length already exceeds the maximum is refused before any of it is read (413);
 *  - at most UPLOAD_MAX_CONCURRENT uploads in progress per instance (503), and UPLOAD_TEMP_QUOTA_MB of temporary data;
 *  - the whole upload must arrive within UPLOAD_TIMEOUT_SECONDS (408);
 *  - all stored documents together stay under STORAGE_QUOTA_MB (507).
 * Temporary files are removed when the response is sent, whatever happened (see releaseUploads, wired in app.ts).
 */

export const MAX_FILES = 4, MAX_FIELDS = 40;
export const maxFileBytes = () => config.UPLOAD_MAX_FILE_MB * 1024 * 1024;
/** Largest acceptable multipart body: every file at the limit, plus room for the text fields and part headers. */
export const maxRequestBytes = () => MAX_FILES * maxFileBytes() + 1024 * 1024;
export const multipartLimits = () => ({ fileSize: maxFileBytes(), files: MAX_FILES, fields: MAX_FIELDS, fieldSize: 10_000, parts: MAX_FILES + MAX_FIELDS, headerPairs: 200 });

const tmpRoot = () => path.resolve(config.UPLOAD_TMP_DIR);

export interface UploadedFile {
  field: string;
  filename: string; // as sent by the browser: display only, never used as a path
  path: string; // the private temporary file
  size: number;
  sha256: string;
  mimeType: string | null; // detected from the bytes; null when not an accepted type
}

// The file's real type is taken from its bytes, not from its name or the browser's Content-Type.
const ALLOWED: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const SNIFF_BYTES = 4100;

/* ---------- per-instance accounting ---------- */
let active = 0, tempBytes = 0;
const pending = new WeakMap<FastifyRequest, { files: string[]; bytes: number }>();
/** For tests and monitoring. */
export const uploadStats = () => ({ active, tempBytes });

/**
 * Creates the temporary directory (owner-only) and removes leftovers from a crash. Refuses a directory inside the
 * document store or the working directory's public folders, so temporary files can never be served or confused with
 * stored ones.
 */
export async function prepareUploadDir() {
  const root = tmpRoot(), store = path.resolve(config.STORAGE_DIR);
  if (root === store || root.startsWith(store + path.sep)) throw new Error('UPLOAD_TMP_DIR must not be inside STORAGE_DIR');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const cutoff = Date.now() - 3600e3;
  for (const name of await readdir(root).catch(() => [] as string[])) {
    const p = path.join(root, name);
    const s = await stat(p).catch(() => null);
    if (s?.isFile() && s.mtimeMs < cutoff) await rm(p, { force: true });
  }
}

/** Removes the request's temporary files and frees its slot. Safe to call more than once. */
export async function releaseUploads(req: FastifyRequest) {
  const p = pending.get(req);
  if (!p) return;
  pending.delete(req);
  active--;
  tempBytes -= p.bytes;
  await Promise.allSettled(p.files.map(f => rm(f, { force: true })));
}

const tooLarge = () => new AppError(413, 'FST_REQ_FILE_TOO_LARGE', `Each file can be at most ${config.UPLOAD_MAX_FILE_MB} MB.`);

/** Streams one file part to a temporary file, hashing it and keeping its first bytes for type detection. */
async function receiveFile(part: { file: NodeJS.ReadableStream & { truncated?: boolean } }, state: { files: string[]; bytes: number }) {
  const file = path.join(tmpRoot(), `${randomUUID()}.upload`);
  state.files.push(file);
  const hash = createHash('sha256'), head: Buffer[] = [];
  let size = 0, headLen = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      state.bytes += chunk.length;
      tempBytes += chunk.length;
      if (tempBytes > config.UPLOAD_TEMP_QUOTA_MB * 1024 * 1024) return cb(new AppError(503, 'UPLOADS_BUSY', 'The server is busy receiving other uploads. Try again in a minute.'));
      hash.update(chunk);
      if (headLen < SNIFF_BYTES) { head.push(chunk.subarray(0, SNIFF_BYTES - headLen)); headLen += Math.min(chunk.length, SNIFF_BYTES - headLen); }
      cb(null, chunk);
    },
  });
  await pipeline(part.file, meter, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
  if (part.file.truncated) throw tooLarge();
  const type = size ? await fileTypeFromBuffer(Buffer.concat(head)) : undefined;
  return { path: file, size, sha256: hash.digest('hex'), mimeType: type && ALLOWED[type.mime] ? type.mime : null };
}

/**
 * Reads a multipart request into text fields and files on disk. Call it only after the caller is authorised, so an
 * unauthorised request never gets as far as writing anything.
 */
export async function readMultipart(req: FastifyRequest) {
  if (!req.isMultipart()) throw badRequest('Send this request as multipart/form-data.');
  const declared = Number(req.headers['content-length']);
  if (declared > maxRequestBytes()) throw new AppError(413, 'FST_REQ_FILE_TOO_LARGE', `The upload is too large. Each file can be at most ${config.UPLOAD_MAX_FILE_MB} MB.`);
  if (active >= config.UPLOAD_MAX_CONCURRENT) throw new AppError(503, 'UPLOADS_BUSY', 'The server is busy receiving other uploads. Try again in a minute.');
  const { _sum } = await prisma.document.aggregate({ _sum: { size: true } });
  if ((_sum.size ?? 0) + maxRequestBytes() > config.STORAGE_QUOTA_MB * 1024 * 1024) throw new AppError(507, 'STORAGE_FULL', 'Document storage is full. Contact the MLAZ Secretariat.');

  const state = { files: [] as string[], bytes: 0 };
  active++;
  pending.set(req, state);
  await mkdir(tmpRoot(), { recursive: true, mode: 0o700 });

  // A stalled or very slow upload is cut off, so it cannot hold a slot and its temporary file indefinitely.
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; req.raw.destroy(); }, config.UPLOAD_TIMEOUT_SECONDS * 1000);
  // No prototype: a part named "__proto__" or "constructor" is just a key, never a way to change the object.
  const fields: Record<string, string> = Object.create(null);
  const files: Record<string, UploadedFile> = Object.create(null);
  try {
    for await (const part of req.parts()) {
      if (part.type !== 'file') { fields[part.fieldname] = String(part.value ?? ''); continue; }
      const f = await receiveFile(part, state);
      if (!f.size) continue; // an empty file input
      if (!f.mimeType) throw badRequest(`${part.filename}: only PDF, JPG or PNG files are accepted.`);
      files[part.fieldname] = { field: part.fieldname, filename: part.filename, ...f };
    }
  } catch (e) {
    await releaseUploads(req);
    if (timedOut) throw new AppError(408, 'UPLOAD_TIMEOUT', 'The upload took too long. Check your connection and try again.');
    if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
    throw e;
  } finally {
    clearTimeout(timer);
  }
  return { fields, files };
}

export interface StoredFile {
  kind: DocumentKind;
  storageKey: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
}

/**
 * Moves a validated upload into storage, returning the columns for a Document row. Done before the database
 * transaction that records it, so slow storage never holds a transaction open.
 */
export async function storeFile(file: UploadedFile, kind: DocumentKind): Promise<StoredFile> {
  const ext = file.mimeType && ALLOWED[file.mimeType];
  if (!file.mimeType || !ext) throw badRequest(`${file.filename}: only PDF, JPG or PNG files are accepted.`);
  // The name and location are generated here; the browser's filename is only kept (sanitised) for display.
  const storageKey = `${kind.toLowerCase()}/${new Date().getUTCFullYear()}/${randomUUID()}.${ext}`;
  await storage.putFile(storageKey, file.path, file.mimeType, file.size);
  const filename = path.basename(file.filename.replace(/\\/g, '/')).replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '').slice(0, 120) || `document.${ext}`;
  return { kind, storageKey, filename, mimeType: file.mimeType, size: file.size, sha256: file.sha256 };
}

/** Removes stored files whose database record was never written, so a failed request leaves nothing behind. */
export async function discardFiles(stored: StoredFile[]) {
  await Promise.allSettled(stored.map(f => storage.remove(f.storageKey)));
}

/** Stores several files; if one is rejected, the ones already stored are removed again. */
export async function storeFiles(list: (readonly [UploadedFile, DocumentKind])[]) {
  const stored: StoredFile[] = [];
  try {
    for (const [file, kind] of list) stored.push(await storeFile(file, kind));
  } catch (e) {
    await discardFiles(stored);
    throw e;
  }
  return stored;
}

/**
 * Runs the database write that records `stored`. If it fails, the files are removed. Pass only the write itself, never
 * work that runs after it commits, or a recorded file could be deleted.
 */
export async function commitFiles<T>(stored: StoredFile[], write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    await discardFiles(stored);
    throw e;
  }
}

export function requireFile(files: Record<string, UploadedFile>, field: string, label: string) {
  const f = files[field];
  if (!f) throw badRequest(`Attach the ${label}.`, { fields: [{ field, message: 'Required' }] });
  return f;
}
