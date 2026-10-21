import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { listNotifications, retryNotification } from '../services/notifications.js';
import { actorOf, requireStaff, userOf } from '../lib/guards.js';
import { ROLE_LABEL, can } from '../lib/rbac.js';
import { parse, s } from '../lib/validate.js';
import * as accounts from '../services/accounts.js';
import { overview } from '../services/dashboard.js';
import { REPORTS, buildReport, toCsv } from '../services/reports.js';
import { getSetting, setSetting } from '../services/settings.js';
import { config } from '../config.js';
import { sendCsv, sendDocument } from './helpers.js';

const STAFF_ROLES = ['ADMIN', 'MEMBERSHIP_OFFICER', 'FINANCE_OFFICER', 'COMMS_OFFICER'] as const;

export default async function adminSystemRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: requireStaff('dashboard:view') }, async req => overview(userOf(req)));

  /** Small counts for the console's sidebar badges, fetched on every page, so kept to cheap count queries. */
  app.get('/nav-counts', { preHandler: requireStaff() }, async () => {
    const [openApplications, mofReview, renewals, awaitingApproval, bankTransfers] = await Promise.all([
      prisma.application.count({ where: { stage: { in: ['DETAILS', 'MOF_REVIEW', 'PAYMENT_PENDING'] } } }),
      prisma.application.count({ where: { stage: 'MOF_REVIEW', recommendedById: null } }),
      prisma.mofRenewal.count({ where: { status: 'PENDING' } }),
      prisma.application.count({ where: { stage: 'MOF_REVIEW', recommendedById: { not: null } } }),
      prisma.payment.count({ where: { status: 'PENDING', method: 'BANK_TRANSFER', documents: { some: {} } } }),
    ]);
    return { openApplications, mofToVerify: mofReview + renewals, awaitingApproval, bankTransfers };
  });

  /** Console search box: members and applications by name, number or town. */
  app.get('/search', { preHandler: requireStaff() }, async req => {
    const q = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query).q;
    const like = { contains: q, mode: 'insensitive' as const };
    const role = userOf(req).role;
    const [members, apps] = await Promise.all([
      can(role, 'members:read') ? prisma.member.findMany({ where: { OR: [{ name: like }, { number: like }, { town: like }] }, take: 8, select: { number: true, name: true, town: true, status: true } }) : [],
      can(role, 'applications:read') ? prisma.application.findMany({ where: { OR: [{ businessName: like }, { ref: like }, { town: like }] }, take: 8, select: { ref: true, businessName: true, town: true, stage: true } }) : [],
    ]);
    return { members, applications: apps };
  });

  /** Any uploaded document (MoF authorization, PACRA, NRC, proof of payment). Viewing is audited. */
  app.get('/documents/:id', { preHandler: requireStaff('documents:read') }, async (req, reply) => {
    const d = await prisma.document.findUnique({ where: { id: (req.params as { id: string }).id }, include: { application: { select: { ref: true } }, member: { select: { number: true } } } });
    if (!d) throw notFound('Document');
    await audit(prisma, actorOf(req), d.application?.ref ?? d.member?.number ?? 'Documents', 'Document viewed', `${d.kind} · ${d.filename}`);
    return sendDocument(reply, d);
  });

  /* ---------- reports & audit ---------- */
  app.get('/reports', { preHandler: requireStaff('reports:read') }, async () => REPORTS.map(({ key, icon, title, description }) => ({ key, icon, title, description })));
  app.get('/reports/:key', { preHandler: requireStaff('reports:read') }, async (req, reply) => {
    const q = parse(z.object({ format: z.enum(['json', 'csv']).default('json'), from: s.date.optional(), to: s.date.optional() }), req.query);
    const r = await buildReport((req.params as { key: string }).key, q);
    if (q.format === 'json') return r;
    await audit(prisma, actorOf(req), 'Reports', 'Report exported', `${r.title} · CSV`);
    return sendCsv(reply, `mlaz-${r.key}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(r));
  });
  app.get('/audit', { preHandler: requireStaff('reports:read') }, async req => {
    const q = parse(s.page.extend({ target: z.string().trim().max(60).optional(), q: z.string().trim().max(100).optional() }), req.query);
    const where = {
      ...(q.target && { target: q.target }),
      ...(q.q && { OR: [{ action: { contains: q.q, mode: 'insensitive' as const } }, { actorLabel: { contains: q.q, mode: 'insensitive' as const } }, { note: { contains: q.q, mode: 'insensitive' as const } }] }),
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  /* ---------- settings ---------- */
  app.get('/settings', { preHandler: requireStaff() }, async () => ({
    tiers: await prisma.tier.findMany({ orderBy: { sortOrder: 'asc' } }),
    joiningFee: await getSetting(prisma, 'joiningFee'),
    renewalWindowDays: await getSetting(prisma, 'renewalWindowDays'),
    bankAccount: await getSetting(prisma, 'bankAccount'),
    roles: STAFF_ROLES.map(r => ({ role: r, label: ROLE_LABEL[r] })),
    integrations: {
      payments: config.PAYMENT_PROVIDER, email: config.SMTP_URL ? 'smtp' : 'log', sms: config.SMS_DRIVER,
      storage: config.STORAGE_DRIVER, creditBureau: config.BUREAU_DRIVER,
    },
  }));

  app.put('/settings/tiers/:name', { preHandler: requireStaff('settings:write') }, async req => {
    const name = (req.params as { name: string }).name;
    const v = parse(z.object({ annualDues: s.money, description: z.string().trim().max(500).optional(), sortOrder: z.coerce.number().int().optional(), active: z.boolean().optional() }), req.body);
    const before = await prisma.tier.findUnique({ where: { name } });
    const t = await prisma.tier.upsert({ where: { name }, create: { name, ...v }, update: v });
    await audit(prisma, actorOf(req), 'Settings', before ? 'Tier updated' : 'Tier created', `${name} · annual dues ${before ? `${before.annualDues} → ` : ''}${v.annualDues}`);
    return t;
  });

  app.put('/settings/fees', { preHandler: requireStaff('settings:write') }, async req => {
    const v = parse(z.object({ joiningFee: s.money, renewalWindowDays: z.coerce.number().int().min(0).max(365) }), req.body);
    await setSetting(prisma, 'joiningFee', v.joiningFee);
    await setSetting(prisma, 'renewalWindowDays', v.renewalWindowDays);
    await audit(prisma, actorOf(req), 'Settings', 'Fees updated', `joining fee ${v.joiningFee} · renewal window ${v.renewalWindowDays} days`);
    return v;
  });

  app.put('/settings/bank-account', { preHandler: requireStaff('settings:write') }, async req => {
    const v = parse(z.object({ bank: s.text(120), name: s.text(120), number: s.text(40), branch: s.text(120) }), req.body);
    await setSetting(prisma, 'bankAccount', v);
    await audit(prisma, actorOf(req), 'Settings', 'Bank account updated', `${v.bank} · ${v.number}`);
    return v;
  });

  /* ---------- staff accounts ---------- */
  app.get('/staff', { preHandler: requireStaff('staff:manage') }, async () => accounts.listStaff());
  app.post('/staff', { preHandler: requireStaff('staff:manage') }, async (req, reply) => {
    const v = parse(z.object({ email: s.email, name: s.text(120), role: z.enum(STAFF_ROLES), title: z.string().trim().max(80).optional() }), req.body);
    const u = await prisma.$transaction(async tx => {
      const user = await accounts.sendInvite(tx, { ...v, title: v.title || ROLE_LABEL[v.role] });
      await audit(tx, actorOf(req), 'Staff', 'Staff account created', `${v.email} · ${ROLE_LABEL[v.role]}`);
      return user;
    });
    return reply.status(201).send({ id: u.id, email: u.email, name: u.name, role: u.role, title: u.title });
  });
  app.patch('/staff/:id', { preHandler: requireStaff('staff:manage') }, async req => {
    const v = parse(z.object({ name: s.line(120), role: z.enum(STAFF_ROLES), title: z.string().trim().max(80).nullable(), active: z.boolean(), resetMfa: z.literal(true) }).partial(), req.body);
    const u = await accounts.updateStaff({ ...actorOf(req), id: userOf(req).id }, (req.params as { id: string }).id, v);
    return { id: u.id, email: u.email, name: u.name, role: u.role, title: u.title, active: u.active, mfaEnabled: !!u.totpEnabledAt };
  });

  /* ---------- message delivery ---------- */
  app.get('/notifications', { preHandler: requireStaff('staff:manage') }, async req =>
    listNotifications(parse(z.object({ status: z.enum(['FAILED', 'PENDING']).default('FAILED') }), req.query).status));
  app.post('/notifications/:id/retry', { preHandler: requireStaff('staff:manage') }, async req => {
    const ok = await retryNotification((req.params as { id: string }).id);
    if (!ok) throw conflict('This message cannot be re-sent. Send a new invitation or reset link instead.');
    await audit(prisma, actorOf(req), 'Communications', 'Message re-queued', (req.params as { id: string }).id);
    return { queued: true };
  });
  app.post('/staff/:id/resend-invite', { preHandler: requireStaff('staff:manage') }, async (req, reply) => {
    await accounts.resendInvite((req.params as { id: string }).id);
    return reply.status(204).send();
  });
}
