import { prisma } from '../../../shared/db.js';
import { BLOCK_MINUTES, LIMITS, WINDOW_MINUTES, accountKey, sourcePrefix } from '../domain/throttle-policy.js';

// The sign-in throttle counters (table LoginThrottle). Each update is one atomic statement, so every API instance
// shares the same numbers and parallel requests cannot slip past a limit. The policy is in domain/throttle-policy.ts.

/** Counts an attempt against `key`. Returns the block end if the key is (now) blocked, else null. */
export async function hit(key: string, max: number): Promise<Date | null> {
  const [row] = await prisma.$queryRaw<{ failures: number; lockedUntil: Date | null }[]>`
    INSERT INTO "LoginThrottle" ("key", "failures", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE WHEN "LoginThrottle"."lockedUntil" > now() THEN "LoginThrottle"."failures"
        WHEN "LoginThrottle"."windowStart" < now() - make_interval(mins => ${WINDOW_MINUTES}) THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
      "windowStart" = CASE WHEN "LoginThrottle"."lockedUntil" > now() THEN "LoginThrottle"."windowStart"
        WHEN "LoginThrottle"."windowStart" < now() - make_interval(mins => ${WINDOW_MINUTES}) THEN now() ELSE "LoginThrottle"."windowStart" END
    RETURNING "failures", "lockedUntil"`;
  if (row.lockedUntil && row.lockedUntil > new Date()) return row.lockedUntil;
  if (row.failures <= max) return null;
  // Over the limit: block, longer for each repeat within a day. Only the first of several racing requests sets it.
  const [locked] = await prisma.$queryRaw<{ lockedUntil: Date }[]>`
    UPDATE "LoginThrottle" t SET "failures" = 0, "windowStart" = now(), "strikes" = s.n,
      "lockedUntil" = now() + make_interval(mins => (${BLOCK_MINUTES}::int[])[LEAST(s.n, ${BLOCK_MINUTES.length})])
    FROM (SELECT CASE WHEN "lockedUntil" IS NULL OR "lockedUntil" < now() - interval '24 hours' THEN 1 ELSE "strikes" + 1 END AS n
          FROM "LoginThrottle" WHERE "key" = ${key}) s
    WHERE t."key" = ${key} AND (t."lockedUntil" IS NULL OR t."lockedUntil" <= now())
    RETURNING t."lockedUntil"`;
  return locked?.lockedUntil ?? (await prisma.loginThrottle.findUnique({ where: { key } }))?.lockedUntil ?? new Date(Date.now() + 60e3);
}

/**
 * Counts an attempt on an account from an unrecognised device. Never blocks; returns true while the account is in
 * challenge mode. Attempts keep counting during the challenge, so a continuing attack keeps extending it.
 */
export async function accountUnderAttack(key: string, challengeMinutes: number) {
  const [row] = await prisma.$queryRaw<{ failures: number; lockedUntil: Date | null }[]>`
    INSERT INTO "LoginThrottle" ("key", "failures", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE WHEN "LoginThrottle"."windowStart" < now() - make_interval(mins => ${WINDOW_MINUTES}) THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
      "windowStart" = CASE WHEN "LoginThrottle"."windowStart" < now() - make_interval(mins => ${WINDOW_MINUTES}) THEN now() ELSE "LoginThrottle"."windowStart" END
    RETURNING "failures", "lockedUntil"`;
  if (row.failures > LIMITS.account) {
    await prisma.$executeRaw`UPDATE "LoginThrottle" SET "failures" = 0, "windowStart" = now(),
      "lockedUntil" = now() + make_interval(mins => ${challengeMinutes}) WHERE "key" = ${key}`;
    return { active: true, started: !(row.lockedUntil && row.lockedUntil > new Date()) };
  }
  return { active: !!row.lockedUntil && row.lockedUntil > new Date(), started: false };
}

/** Blocks `key` outright for `minutes` (a sign-in step that was used up or completed). */
export const burn = (key: string, minutes: number) => prisma.$executeRaw`
  INSERT INTO "LoginThrottle" ("key", "failures", "windowStart", "lockedUntil") VALUES (${key}, 0, now(), now() + make_interval(mins => ${minutes}))
  ON CONFLICT ("key") DO UPDATE SET "lockedUntil" = GREATEST(COALESCE("LoginThrottle"."lockedUntil", now()), EXCLUDED."lockedUntil")`;

/**
 * Marks `key` used for `minutes`, atomically: true for exactly one caller while it is not already blocked. A parallel
 * caller waits for the row and then finds it taken.
 */
export async function claim(key: string, minutes: number) {
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "LoginThrottle" ("key", "failures", "windowStart", "lockedUntil") VALUES (${key}, 0, now(), now() + make_interval(mins => ${minutes}))
    ON CONFLICT ("key") DO UPDATE SET "lockedUntil" = EXCLUDED."lockedUntil"
    WHERE "LoginThrottle"."lockedUntil" IS NULL OR "LoginThrottle"."lockedUntil" <= now()
    RETURNING "key"`;
  return rows.length > 0;
}

/** Hands back an attempt that turned out to be legitimate. */
export const refund = (keys: string[]) => prisma.$executeRaw`
  UPDATE "LoginThrottle" SET "failures" = GREATEST("failures" - 1, 0) WHERE "key" = ANY(${keys}::text[])`;
export const clear = (keys: string[]) => prisma.loginThrottle.deleteMany({ where: { key: { in: keys } } });

/** After a reset link was used (proof of the mailbox): lift every block and the challenge on the account. */
export const clearPasswordFailures = (email: string) =>
  prisma.loginThrottle.deleteMany({ where: { OR: [{ key: accountKey(email) }, { key: { startsWith: sourcePrefix(email) } }] } });
