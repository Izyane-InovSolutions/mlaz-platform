import type { Db } from './db.js';

export type CounterKey = 'member' | 'application' | 'payment' | 'expense';
const PREFIX: Record<CounterKey, string> = { member: 'MLA-', application: 'APP-', payment: 'PAY-', expense: 'EXP-' };

/** Allocates the next human reference (MLA-0428, APP-2045, ...). Atomic, so concurrent requests never share a number. */
export async function nextRef(db: Db, key: CounterKey): Promise<string> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return PREFIX[key] + String(rows[0].value).padStart(4, '0');
}
