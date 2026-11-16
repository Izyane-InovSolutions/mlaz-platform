import type { Prisma as P } from '../../../generated/prisma/client.js';
import { type Db, prisma } from '../../../shared/db.js';
import { badRequest } from '../../../shared/errors.js';
import { PROVINCES } from '../../../shared/validation.js';
import { activeTiers } from '../../administration/index.js';
import type { AudienceDirectory } from '../../communications/index.js';
import { duesDueWhere } from './queries.js';

// Broadcast audiences, provided to communications through its AudienceDirectory port (wired in platform/modules.ts).
// Audiences: ALL, DUES_DUE (dues payable now or overdue), LAPSED, SUSPENDED, TIER:<name>, PROVINCE:<name>

async function audienceWhere(db: Db, audience: string): Promise<P.MemberWhereInput> {
  if (audience === 'ALL') return { status: { not: 'SUSPENDED' } };
  if (audience === 'LAPSED') return { status: 'LAPSED' };
  if (audience === 'SUSPENDED') return { status: 'SUSPENDED' };
  if (audience === 'DUES_DUE') return duesDueWhere(db);
  const [kind, value] = audience.split(':');
  if (kind === 'TIER' && value) return { tierName: value, status: { not: 'SUSPENDED' } };
  if (kind === 'PROVINCE' && (PROVINCES as readonly string[]).includes(value)) return { province: value, status: { not: 'SUSPENDED' } };
  throw badRequest(`Unknown audience ${audience}.`);
}

export const memberAudiences: AudienceDirectory = {
  async list() {
    const tiers = await activeTiers(prisma);
    const keys = [
      ['ALL', 'All members'], ['DUES_DUE', 'Dues due or overdue'], ['LAPSED', 'Lapsed members'], ['SUSPENDED', 'Suspended members'],
      ...tiers.map(t => [`TIER:${t.name}`, `${t.name} tier`]),
      ...PROVINCES.map(p => [`PROVINCE:${p}`, `${p} Province`]),
    ];
    return Promise.all(keys.map(async ([key, label]) => ({ key, label, count: await prisma.member.count({ where: await audienceWhere(prisma, key) }) })));
  },
  async recipients(audience) {
    const where = await audienceWhere(prisma, audience);
    return prisma.member.findMany({ where, select: { contactEmail: true, contactPhone: true } });
  },
};
