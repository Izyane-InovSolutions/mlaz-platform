import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { config } from '../config.js';

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });

/** A transaction client. Service functions take this so callers can compose them inside one transaction. */
export type Tx = Prisma.TransactionClient;
export type Db = typeof prisma | Tx;

/**
 * Serialises transactions that act on the same thing (a member's dues, an application's payment, a member's credit
 * checks) when there is no single row to lock. Held until the transaction ends.
 */
export async function lockKey(tx: Tx, key: string) {
  // $executeRaw, not $queryRaw: the function returns void, which Prisma cannot read back as a column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export { Prisma };
