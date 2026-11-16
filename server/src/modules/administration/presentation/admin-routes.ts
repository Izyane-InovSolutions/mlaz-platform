import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, s } from '../../../shared/validation.js';
import { actorOf, requireStaff } from '../../identity/http.js';
import { settingsView, updateBankAccount, updateFees, upsertTier } from '../application/manage-settings.js';

// Tier names appear in the console, broadcast audiences and certificates: letters, digits and simple punctuation only.
const tierName = z.object({ name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 &()+.-]{0,39}$/, 'Use letters, digits, spaces and & ( ) + . - only (up to 40 characters)') });

export default async function administrationAdminRoutes(app: FastifyInstance) {
  app.get('/settings', { preHandler: requireStaff() }, async () => settingsView());

  app.put('/settings/tiers/:name', { preHandler: requireStaff('settings:write') }, async req => {
    const { name } = parse(tierName, req.params);
    const v = parse(z.object({ annualDues: s.money, description: z.string().trim().max(500).optional(), sortOrder: z.coerce.number().int().optional(), active: z.boolean().optional() }), req.body);
    return upsertTier(actorOf(req), name, v);
  });

  app.put('/settings/fees', { preHandler: requireStaff('settings:write') }, async req =>
    updateFees(actorOf(req), parse(z.object({ joiningFee: s.money, renewalWindowDays: z.coerce.number().int().min(0).max(365) }), req.body)));

  app.put('/settings/bank-account', { preHandler: requireStaff('settings:write') }, async req =>
    updateBankAccount(actorOf(req), parse(z.object({ bank: s.text(120), name: s.text(120), number: s.text(40), branch: s.text(120) }), req.body)));
}
