import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { config } from '../config.js';

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });

/** A transaction client. Service functions take this so callers can compose them inside one transaction. */
export type Tx = Prisma.TransactionClient;
export type Db = typeof prisma | Tx;

export { Prisma };
