import type { Prisma as P } from '../generated/prisma/client.js';
import { daysBetween, dateOnly, fmtDate, fmtDateTime, today } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { K, num } from '../lib/money.js';
import { inGoodStanding } from './membership.js';
import { METHOD_LABEL } from './payments.js';
import { getSetting } from './settings.js';

export interface Table { cols: string[]; rows: (string | number)[][] }
interface Range { from?: string; to?: string }

const dateRange = (r: Range): P.DateTimeFilter | undefined =>
  r.from || r.to ? { ...(r.from && { gte: dateOnly(r.from) }), ...(r.to && { lt: new Date(dateOnly(r.to).getTime() + 864e5) }) } : undefined;

export const REPORTS: { key: string; icon: string; title: string; description: string; build: (r: Range) => Promise<Table> }[] = [
  {
    key: 'register', icon: 'people', title: 'Member register & accreditation status',
    description: 'Every member with tier, region, MoF and accreditation status, dues and validity.',
    build: async () => {
      const ms = await prisma.member.findMany({ orderBy: { number: 'asc' } });
      return {
        cols: ['Member no.', 'Name', 'Province', 'Town', 'Tier', 'Status', 'MoF', 'MoF expiry', 'Accreditation', 'Good standing', 'Valid until', 'Contact', 'Phone', 'Email'],
        rows: ms.map(m => [m.number, m.name, m.province, m.town, m.tierName, m.status, m.mofStatus, m.mofExpiry ? fmtDate(m.mofExpiry) : '', m.accreditation, inGoodStanding(m) ? 'Yes' : 'No', fmtDate(m.validUntil), m.contactName, m.contactPhone, m.contactEmail]),
      };
    },
  },
  {
    key: 'collections', icon: 'cash-stack', title: 'Collections by channel',
    description: 'Successful payments grouped by channel, with transaction counts and totals.',
    build: async r => {
      const by = await prisma.payment.groupBy({ by: ['method'], where: { status: 'SUCCESS', paidAt: dateRange(r) }, _count: true, _sum: { amount: true } });
      const rows = by.sort((a, b) => num(b._sum.amount) - num(a._sum.amount)).map(x => [METHOD_LABEL[x.method], x._count, K(x._sum.amount ?? 0)]);
      const total = by.reduce((a, x) => ({ n: a.n + x._count, amt: a.amt + num(x._sum.amount) }), { n: 0, amt: 0 });
      return { cols: ['Channel', 'Transactions', 'Collected'], rows: [...rows, ['Total', total.n, K(total.amt)]] };
    },
  },
  {
    key: 'payments', icon: 'receipt', title: 'Payment transactions',
    description: 'Every payment with payer, purpose, method, amount and status.',
    build: async r => {
      const ps = await prisma.payment.findMany({ where: { createdAt: dateRange(r) }, orderBy: { createdAt: 'desc' }, include: { lines: true } });
      return {
        cols: ['Reference', 'Date', 'Payer', 'Description', 'Method', 'Amount', 'Status', 'Bank ref', 'Recorded / reviewed by'],
        rows: ps.map(p => [p.ref, fmtDateTime(p.createdAt), p.payerName, p.lines.map(l => l.description).join('; '), METHOD_LABEL[p.method], num(p.amount), p.status, p.bankRef ?? '', p.recordedBy ?? p.reviewedBy ?? '']),
      };
    },
  },
  {
    key: 'arrears', icon: 'hourglass-split', title: 'Arrears & renewal pipeline',
    description: 'Members whose dues are payable or overdue, who are lapsed, or whose accreditation expires within 90 days.',
    build: async () => {
      const windowDays = Math.max(90, await getSetting(prisma, 'renewalWindowDays'));
      const t = today();
      const ms = await prisma.member.findMany({ where: { OR: [{ status: { not: 'ACTIVE' } }, { validUntil: { lte: new Date(t.getTime() + windowDays * 864e5) } }] }, include: { tier: true }, orderBy: { validUntil: 'asc' } });
      return {
        cols: ['Member no.', 'Name', 'Tier', 'Status', 'Dues amount', 'Valid until', 'Days to expiry', 'Contact', 'Phone'],
        rows: ms.map(m => [m.number, m.name, m.tierName, m.status, K(m.tier.annualDues), fmtDate(m.validUntil), daysBetween(t, m.validUntil), m.contactName, m.contactPhone]),
      };
    },
  },
  {
    key: 'events', icon: 'calendar-event', title: 'Event attendance & training',
    description: 'Registrations against capacity, ticket prices and revenue for AGMs, trainings and webinars.',
    build: async () => {
      const es = await prisma.event.findMany({ orderBy: { date: 'desc' }, include: { registrations: { include: { payment: true } } } });
      return {
        cols: ['Event', 'Type', 'Date', 'Venue', 'Status', 'Registered', 'Capacity', 'Fill rate', 'Ticket price', 'Revenue', 'Refunds due'],
        rows: es.map(e => {
          const active = e.registrations.filter(x => x.status !== 'CANCELLED');
          const reg = active.reduce((a, x) => a + x.tickets, 0);
          const rev = e.registrations.filter(x => x.payment?.status === 'SUCCESS').reduce((a, x) => a + num(x.amount), 0);
          return [e.name, e.type, fmtDate(e.date), e.venue, e.status, reg, e.capacity, `${Math.round((reg / e.capacity) * 100)}%`, num(e.price) ? K(e.price) : 'Free', K(rev), e.registrations.filter(x => x.refundDue).length];
        }),
      };
    },
  },
  {
    key: 'expenses', icon: 'wallet2', title: 'Expenses',
    description: 'Recorded expenses by date, category, payee and linked event.',
    build: async r => {
      const xs = await prisma.expense.findMany({ where: { deletedAt: null, date: dateRange(r) }, orderBy: { date: 'desc' }, include: { event: { select: { name: true } } } });
      return {
        cols: ['Reference', 'Date', 'Category', 'Description', 'Payee', 'Method', 'Amount', 'Event', 'Recorded by'],
        rows: [...xs.map(x => [x.ref, fmtDate(x.date), x.category, x.description, x.payee, x.method, num(x.amount), x.event?.name ?? '', x.recordedBy]), ['Total', '', '', '', '', '', xs.reduce((a, x) => a + num(x.amount), 0), '', '']],
      };
    },
  },
  {
    key: 'comms', icon: 'megaphone', title: 'Communications sent',
    description: 'Broadcasts sent by email, SMS and portal, with audience and recipient count.',
    build: async r => {
      const bs = await prisma.broadcast.findMany({ where: { createdAt: dateRange(r) }, orderBy: { createdAt: 'desc' } });
      return { cols: ['Date', 'Subject', 'Audience', 'Channels', 'Recipients', 'Sent by'], rows: bs.map(b => [fmtDateTime(b.createdAt), b.subject, b.audience, b.channels.join(', '), b.recipientCount, b.createdBy]) };
    },
  },
  {
    key: 'audit', icon: 'clock-history', title: 'Audit trail of approvals & changes',
    description: 'Every recorded decision and change, with user and time.',
    build: async r => {
      const xs = await prisma.auditLog.findMany({ where: { at: dateRange(r) }, orderBy: { at: 'desc' }, take: 5000 });
      return { cols: ['Date & time', 'User', 'Record', 'Action', 'Details'], rows: xs.map(x => [fmtDateTime(x.at), x.actorLabel, x.target, x.action, x.note]) };
    },
  },
];

export async function buildReport(key: string, range: Range) {
  const r = REPORTS.find(x => x.key === key);
  if (!r) throw notFound(`Report ${key}`);
  return { key: r.key, title: r.title, generatedAt: new Date(), ...(await r.build(range)) };
}

/** CSV with a byte-order mark so Excel opens it with the right encoding. */
export function toCsv(t: Table) {
  const cell = (v: string | number) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  return '﻿' + [t.cols, ...t.rows].map(r => r.map(cell).join(',')).join('\r\n');
}
