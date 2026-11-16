import type { Actor } from '../../../shared/actor.js';
import { prisma } from '../../../shared/db.js';
import { integrations } from '../../../shared/integrations.js';
import { audit } from '../../audit/index.js';
import { ROLE_LABEL, STAFF_ROLES } from '../../identity/index.js';
import { type Settings, getSetting, setSetting } from './settings.js';

// The Secretariat's settings screen. Each change and its audit entry are written together.

export async function settingsView() {
  return {
    tiers: await prisma.tier.findMany({ orderBy: { sortOrder: 'asc' } }),
    joiningFee: await getSetting(prisma, 'joiningFee'),
    renewalWindowDays: await getSetting(prisma, 'renewalWindowDays'),
    bankAccount: await getSetting(prisma, 'bankAccount'),
    roles: STAFF_ROLES.map(r => ({ role: r, label: ROLE_LABEL[r] })),
    integrations: integrations(),
  };
}

interface TierInput { annualDues: number; description?: string; sortOrder?: number; active?: boolean }

/** Creates or updates a tier. Names are validated by the caller (they appear in audiences and on certificates). */
export function upsertTier(actor: Actor, name: string, v: TierInput) {
  return prisma.$transaction(async tx => {
    const before = await tx.tier.findUnique({ where: { name } });
    const t = await tx.tier.upsert({ where: { name }, create: { name, ...v }, update: v });
    await audit(tx, actor, 'Settings', before ? 'Tier updated' : 'Tier created', `${name} · annual dues ${before ? `${before.annualDues} → ` : ''}${v.annualDues}`);
    return t;
  });
}

export async function updateFees(actor: Actor, v: { joiningFee: number; renewalWindowDays: number }) {
  await prisma.$transaction(async tx => {
    await setSetting(tx, 'joiningFee', v.joiningFee);
    await setSetting(tx, 'renewalWindowDays', v.renewalWindowDays);
    await audit(tx, actor, 'Settings', 'Fees updated', `joining fee ${v.joiningFee} · renewal window ${v.renewalWindowDays} days`);
  });
  return v;
}

export async function updateBankAccount(actor: Actor, v: Settings['bankAccount']) {
  await prisma.$transaction(async tx => {
    await setSetting(tx, 'bankAccount', v);
    await audit(tx, actor, 'Settings', 'Bank account updated', `${v.bank} · ${v.number}`);
  });
  return v;
}
