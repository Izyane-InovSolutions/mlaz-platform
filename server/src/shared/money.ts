import type { Prisma } from './db.js';

type Amount = number | string | Prisma.Decimal;

/** Kwacha amounts are Decimal(12,2) in the database; arithmetic in the services uses plain numbers rounded to ngwee. */
export const num = (v: Amount | null | undefined) => (v == null ? 0 : Math.round(Number(v) * 100) / 100);
export const sum = (xs: Amount[]) => Math.round(xs.reduce<number>((a, x) => a + num(x) * 100, 0)) / 100;

export const K = (v: Amount) => {
  const n = num(v);
  return 'K' + n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
};
