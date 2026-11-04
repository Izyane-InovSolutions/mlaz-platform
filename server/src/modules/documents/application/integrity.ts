import { prisma } from '../../../shared/db.js';
import { log } from '../../../shared/log.js';
import { storage } from '../infrastructure/storage.js';

// Compares document storage with the Document table, both ways.
//
// Orphans: files with no record. A file is stored before the transaction that records it (files.ts); if the process
// dies in between, or the clean-up after a failed transaction fails too, the file stays without a record. Nothing can
// reach it, but it takes space and holds personal data that no one is responsible for.
//
// Missing files: records whose file is not in storage. Never repaired automatically; they need an operator (restore
// the bucket from its versions or backup). Reported every run.

// Only names this server generates (files.ts: `<kind>/<year>/<uuid>.<ext>`, seed data: `<kind>/seed/<uuid>.pdf`) can be
// orphans. Anything else in the bucket was not put there by this application and is never touched.
const GENERATED_KEY = /^[a-z_]+\/(?:\d{4}|seed)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:pdf|jpg|png)$/;
// More orphans than this in one run is not crash debris: the database was probably restored to an earlier time, or the
// API points at the wrong bucket or database. Those files may be the only copy of real documents, so nothing is
// removed and an operator is alerted instead.
export const MAX_REMOVALS_PER_RUN = 200;
const BATCH = 500;
const SAMPLE = 50; // keys or ids listed in a log line

export interface SweepOptions {
  /** Remove orphans (true) or only report them (false). */
  remove: boolean;
  /** Files written more recently than this are never orphans: their request may still be about to record them. */
  graceMs: number;
  now?: Date;
}

export async function sweepStorage({ remove, graceMs, now = new Date() }: SweepOptions) {
  const startedAt = now;
  const cutoff = now.getTime() - graceMs;
  const keys = new Set<string>();
  const candidates: string[] = [];
  let unrecognised = 0;
  for await (const o of storage.list()) {
    keys.add(o.key);
    if (!GENERATED_KEY.test(o.key)) unrecognised++;
    else if (o.modifiedAt.getTime() < cutoff) candidates.push(o.key);
  }

  const orphans: string[] = [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    const chunk = candidates.slice(i, i + BATCH);
    const known = new Set((await prisma.document.findMany({ where: { storageKey: { in: chunk } }, select: { storageKey: true } })).map(d => d.storageKey));
    orphans.push(...chunk.filter(k => !known.has(k)));
  }

  // Records written before the listing began must have had their file listed; later ones may not have been.
  const missing: string[] = [];
  let records = 0;
  for (let cursor: string | undefined; ;) {
    const page = await prisma.document.findMany({
      where: { createdAt: { lt: startedAt } }, select: { id: true, storageKey: true }, orderBy: { id: 'asc' }, take: BATCH,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    records += page.length;
    missing.push(...page.filter(d => !keys.has(d.storageKey)).map(d => d.id));
    if (page.length < BATCH) break;
    cursor = page[page.length - 1].id;
  }

  let removed = 0, removeFailed = 0;
  const refused = remove && orphans.length > MAX_REMOVALS_PER_RUN;
  if (refused) {
    log().error({ event: 'storage.sweep_refused', orphans: orphans.length, limit: MAX_REMOVALS_PER_RUN, sample: orphans.slice(0, SAMPLE) },
      `Storage sweep found ${orphans.length} files without a record, more than the ${MAX_REMOVALS_PER_RUN} it may remove in one run; nothing was removed. Check that the API points at the right database and bucket (was the database restored?).`);
  } else if (remove) {
    for (const key of orphans) {
      // Checked again just before removal: never delete a file that has a record, however it got one.
      if (await prisma.document.findUnique({ where: { storageKey: key }, select: { id: true } })) continue;
      try {
        await storage.remove(key);
        removed++;
        log().info({ event: 'storage.orphan_removed', key }, `Removed stored file without a record: ${key}`);
      } catch (err) {
        removeFailed++;
        log().error({ event: 'storage.orphan_remove_failed', key, err }, `Could not remove stored file without a record: ${key}`);
      }
    }
  } else if (orphans.length) {
    log().warn({ event: 'storage.orphans_found', orphans: orphans.length, sample: orphans.slice(0, SAMPLE) },
      `${orphans.length} stored file(s) have no record (report only; set STORAGE_SWEEP=delete to remove them)`);
  }
  if (missing.length) {
    log().error({ event: 'storage.missing_files', missing: missing.length, documentIds: missing.slice(0, SAMPLE) },
      `${missing.length} document record(s) have no file in storage`);
  }

  const summary = { files: keys.size, records, unrecognised, orphans: orphans.length, removed, removeFailed, refused, missing: missing.length };
  log().info({ event: 'storage.sweep_finished', mode: remove ? 'delete' : 'report', ...summary }, 'storage integrity sweep finished');
  return summary;
}
