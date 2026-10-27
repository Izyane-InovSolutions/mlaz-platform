import type { Db, Prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { num } from '../lib/money.js';

export const SETTING_DEFAULTS = {
  joiningFee: 2000,
  /** Dues for the next period become payable this many days before the current period ends. */
  renewalWindowDays: 60,
  bankAccount: {
    bank: 'Zambia National Commercial Bank (Zanaco)',
    name: 'Money Lenders Association of Zambia',
    number: '0123 4567 8901',
    branch: 'Cairo Road, Lusaka',
  },
};
export type Settings = typeof SETTING_DEFAULTS;

export async function getSetting<K extends keyof Settings>(db: Db, key: K): Promise<Settings[K]> {
  const row = await db.setting.findUnique({ where: { key } });
  return (row?.value as Settings[K] | undefined) ?? SETTING_DEFAULTS[key];
}

export async function setSetting<K extends keyof Settings>(db: Db, key: K, value: Settings[K]) {
  const json = value as unknown as Prisma.InputJsonValue;
  await db.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}

export async function fees(db: Db) {
  const tiers = await db.tier.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  const joiningFee = await getSetting(db, 'joiningFee');
  return {
    joiningFee: num(joiningFee),
    tiers: tiers.map(t => ({ name: t.name, annualDues: num(t.annualDues), description: t.description })),
  };
}

export async function tierDues(db: Db, tierName: string) {
  const t = await db.tier.findUnique({ where: { name: tierName } });
  if (!t) throw notFound(`Tier ${tierName}`);
  return num(t.annualDues);
}
