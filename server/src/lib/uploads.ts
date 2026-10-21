import { randomUUID } from 'node:crypto';
import '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { fileTypeFromBuffer } from 'file-type';
import type { DocumentKind } from '../generated/prisma/client.js';
import { badRequest } from './errors.js';
import { storage } from './storage.js';
import { sha256 } from './tokens.js';

export interface UploadedFile {
  field: string;
  filename: string;
  buffer: Buffer;
}

/** Reads a multipart request into text fields and in-memory files. Size limits are enforced by @fastify/multipart. */
export async function readMultipart(req: FastifyRequest) {
  if (!req.isMultipart()) throw badRequest('Send this request as multipart/form-data.');
  // No prototype: a part named "__proto__" or "constructor" is just a key, never a way to change the object.
  const fields: Record<string, string> = Object.create(null);
  const files: Record<string, UploadedFile> = Object.create(null);
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (buffer.length) files[part.fieldname] = { field: part.fieldname, filename: part.filename, buffer };
    } else {
      fields[part.fieldname] = String(part.value ?? '');
    }
  }
  return { fields, files };
}

// The file's real type is taken from its bytes, not from its name or the browser's Content-Type.
const ALLOWED: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

export interface StoredFile {
  kind: DocumentKind;
  storageKey: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
}

/**
 * Validates and stores a file, returning the columns for a Document row. Done before the database transaction that
 * records it, so slow storage never holds a transaction open.
 */
export async function storeFile(file: UploadedFile, kind: DocumentKind): Promise<StoredFile> {
  const type = await fileTypeFromBuffer(file.buffer);
  const ext = type && ALLOWED[type.mime];
  if (!type || !ext) throw badRequest(`${file.filename}: only PDF, JPG or PNG files are accepted.`);
  const storageKey = `${kind.toLowerCase()}/${new Date().getUTCFullYear()}/${randomUUID()}.${ext}`;
  await storage.put(storageKey, file.buffer, type.mime);
  const filename = file.filename.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || `document.${ext}`;
  return { kind, storageKey, filename, mimeType: type.mime, size: file.buffer.length, sha256: sha256(file.buffer) };
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
