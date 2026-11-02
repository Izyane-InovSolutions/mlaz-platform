import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';

// Cluster-wide leases for background jobs that must not run on two API instances at once. Held in Postgres (the one
// store every instance shares), not in memory. Times come from the database clock, so instances with drifting clocks
// still agree on when a lease ends, and `expiresAt` is stored as UTC like every other timestamp Prisma writes.
//
// - Acquire: one atomic upsert that only takes over a lease whose time is up. Two instances racing for it serialise
//   on the row; exactly one gets it.
// - Renew and release: only with the random owner token from acquiring, so a holder that overran its lease (and lost
//   it to another instance) can neither extend nor end the new holder's lease. Renewing doubles as the fence a long
//   run checks before each unit of work.
// - Crash: nothing to clean up. The lease simply runs out.

export interface Lease {
  name: string;
  owner: string;
  /** Extends the lease by its TTL from now. False when it was lost, in which case the holder must stop. */
  renew(): Promise<boolean>;
  /** Ends the lease now, or keeps others out for `holdForMs` more (a cool-down so the job runs once per interval). */
  release(holdForMs?: number): Promise<void>;
}

const ms = (n: number) => Math.max(0, Math.round(n));

export async function acquireLease(name: string, ttlMs: number): Promise<Lease | null> {
  const owner = randomUUID();
  const rows = await prisma.$queryRaw<{ owner: string }[]>`
    INSERT INTO "JobLease" ("name", "owner", "expiresAt", "acquiredAt")
    VALUES (${name}, ${owner}, (now() AT TIME ZONE 'UTC') + make_interval(secs => ${ms(ttlMs)}::int / 1000.0), now() AT TIME ZONE 'UTC')
    ON CONFLICT ("name") DO UPDATE SET "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt", "acquiredAt" = EXCLUDED."acquiredAt"
    WHERE "JobLease"."expiresAt" <= now() AT TIME ZONE 'UTC'
    RETURNING "owner"`;
  if (rows[0]?.owner !== owner) return null;
  return {
    name, owner,
    renew: async () => (await prisma.$executeRaw`
      UPDATE "JobLease" SET "expiresAt" = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${ms(ttlMs)}::int / 1000.0)
      WHERE "name" = ${name} AND "owner" = ${owner}`) > 0,
    release: async (holdForMs = 0) => {
      if (holdForMs > 0) {
        await prisma.$executeRaw`
          UPDATE "JobLease" SET "expiresAt" = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${ms(holdForMs)}::int / 1000.0)
          WHERE "name" = ${name} AND "owner" = ${owner}`;
      } else {
        await prisma.$executeRaw`DELETE FROM "JobLease" WHERE "name" = ${name} AND "owner" = ${owner}`;
      }
    },
  };
}

/**
 * Runs `fn` only if this instance gets the lease, and releases it afterwards, holding it `holdForMs(elapsedMs)` longer
 * so the cluster as a whole runs the job once per interval rather than once per instance. Returns null when another
 * instance holds the lease. A failed release is harmless: the lease runs out by itself.
 */
export async function withLease<T>(name: string, ttlMs: number, fn: (lease: Lease) => Promise<T>, holdForMs: (elapsedMs: number) => number = () => 0) {
  const lease = await acquireLease(name, ttlMs);
  if (!lease) return null;
  const started = Date.now();
  try {
    return { result: await fn(lease) };
  } finally {
    await lease.release(holdForMs(Date.now() - started)).catch(() => {});
  }
}
