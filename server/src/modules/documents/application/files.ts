import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DocumentKind } from '../../../generated/prisma/client.js';
import { config } from '../../../config.js';
import { prisma } from '../../../shared/db.js';
import { AppError, badRequest } from '../../../shared/errors.js';
import { storage } from '../infrastructure/storage.js';

// Validated uploads (received by presentation/multipart.ts) move into document storage here. Files are stored before
// the database transaction that records them, so slow storage never holds a transaction open, and are removed again
// if that transaction fails, so a failed request leaves nothing behind.

export interface UploadedFile {
  field: string;
  filename: string; // as sent by the browser: display only, never used as a path
  path: string; // the private temporary file
  size: number;
  sha256: string;
  mimeType: string | null; // detected from the bytes; null when not an accepted type
}

export interface StoredFile {
  kind: DocumentKind;
  storageKey: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
}

// The file's real type is taken from its bytes, not from its name or the browser's Content-Type.
export const ALLOWED_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Refuses an upload that could take all stored documents together past STORAGE_QUOTA_MB (507). */
export async function assertStorageRoom(incomingBytes: number) {
  const { _sum } = await prisma.document.aggregate({ _sum: { size: true } });
  if ((_sum.size ?? 0) + incomingBytes > config.STORAGE_QUOTA_MB * 1024 * 1024) throw new AppError(507, 'STORAGE_FULL', 'Document storage is full. Contact the MLAZ Secretariat.');
}

export function requireFile(files: Record<string, UploadedFile>, field: string, label: string) {
  const f = files[field];
  if (!f) throw badRequest(`Attach the ${label}.`, { fields: [{ field, message: 'Required' }] });
  return f;
}

/** Moves a validated upload into storage, returning the columns for a Document row. */
export async function storeFile(file: UploadedFile, kind: DocumentKind): Promise<StoredFile> {
  const ext = file.mimeType && ALLOWED_TYPES[file.mimeType];
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

/** Opens a stored document for streaming to the client; never read into memory whole. */
export const openStored = (storageKey: string) => storage.stream(storageKey);
