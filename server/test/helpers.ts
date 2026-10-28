import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { fileTypeFromBuffer } from 'file-type';
import { expect } from 'vitest';
import { config } from '../src/config.js';
import type { UploadedFile } from '../src/lib/uploads.js';
import type { MemberStatus, Role } from '../src/generated/prisma/client.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/lib/auth.js';
import { addDays, addYears, today } from '../src/lib/dates.js';
import { prisma } from '../src/lib/db.js';
import { SETTING_DEFAULTS, setSetting } from '../src/services/settings.js';

export const PASSWORD = 'Test@password1';
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

export const STAFF = {
  admin: 'admin@mlaz.org.zm',
  officer: 'officer@mlaz.org.zm',
  finance: 'finance@mlaz.org.zm',
  comms: 'comms@mlaz.org.zm',
} as const;

let app: FastifyInstance | null = null;
export async function getApp() {
  app ??= await buildApp();
  await app.ready();
  return app;
}

/** Empties every table and adds the minimum configuration: tiers, fees, counters and one user per staff role. */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await prisma.tier.createMany({ data: [{ name: 'Gold', annualDues: 4500, sortOrder: 1 }, { name: 'Silver', annualDues: 3000, sortOrder: 2 }, { name: 'Bronze', annualDues: 1800, sortOrder: 3 }] });
  for (const [k, v] of Object.entries(SETTING_DEFAULTS)) await setSetting(prisma, k as keyof typeof SETTING_DEFAULTS, v as never);
  await prisma.counter.createMany({ data: [{ key: 'member', value: 100 }, { key: 'application', value: 500 }, { key: 'payment', value: 1000 }, { key: 'expense', value: 0 }] });
  const passwordHash = await hashPassword(PASSWORD);
  const roles: Record<keyof typeof STAFF, Role> = { admin: 'ADMIN', officer: 'MEMBERSHIP_OFFICER', finance: 'FINANCE_OFFICER', comms: 'COMMS_OFFICER' };
  for (const [k, email] of Object.entries(STAFF)) await prisma.user.create({ data: { email, name: `Test ${k}`, role: roles[k as keyof typeof STAFF], passwordHash } });
}

export async function login(email: string, password = PASSWORD) {
  const res = await (await getApp()).inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  expect(res.statusCode, res.body).toBe(200);
  const refreshToken = res.cookies.find(c => c.name === 'mlaz_rt')?.value ?? '';
  return { ...(res.json() as { accessToken: string; user: { id: string } }), refreshToken };
}

/** Calls /auth/refresh the way the browser does: cookie plus the anti-CSRF header. */
export async function refreshWith(refreshToken: string, headers: Record<string, string> = { 'x-mlaz-csrf': '1' }) {
  return (await getApp()).inject({ method: 'POST', url: '/api/auth/refresh', headers, cookies: { mlaz_rt: refreshToken }, payload: {} });
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Calls the API as a signed-in user. */
export async function as(email: string) {
  const { accessToken } = await login(email);
  const a = await getApp();
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    a.inject({ method, url: `/api${url}`, headers: bearer(accessToken), ...(payload !== undefined && { payload: payload as object }) });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload: unknown = {}) => call('POST', url, payload),
    patch: (url: string, payload: unknown) => call('PATCH', url, payload),
    put: (url: string, payload: unknown) => call('PUT', url, payload),
    del: (url: string) => call('DELETE', url),
    multipart: (url: string, form: FormData) => a.inject({ method: 'POST', url: `/api${url}`, headers: bearer(accessToken), payload: form }),
  };
}

/** An upload as readMultipart leaves it (a private temporary file), for calling services directly. */
export async function tempUpload(field: string, filename: string, body: Buffer): Promise<UploadedFile> {
  const dir = path.resolve(config.UPLOAD_TMP_DIR);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}.upload`);
  await writeFile(file, body);
  const type = await fileTypeFromBuffer(body);
  return { field, filename, path: file, size: body.length, sha256: createHash('sha256').update(body).digest('hex'), mimeType: type?.mime ?? null };
}

export function form(fields: Record<string, string>, files: Record<string, Buffer> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [k, v] of Object.entries(files)) f.append(k, new Blob([new Uint8Array(v)], { type: 'application/pdf' }), `${k}.pdf`);
  return f;
}

let seq = 0;
/** Inserts a member (and their portal user) directly, for tests that start from an existing membership. */
export async function makeMember(o: { validUntil?: Date; mofExpiry?: Date; status?: MemberStatus; tier?: string } = {}) {
  seq++;
  const email = `member${seq}@example.zm`;
  const m = await prisma.member.create({
    data: {
      number: `MLA-${String(9000 + seq)}`, name: `Test Lender ${seq}`, town: 'Lusaka', province: 'Lusaka', tpin: String(2000000000 + seq), tierName: o.tier ?? 'Silver',
      status: o.status ?? 'ACTIVE', accreditation: o.status && o.status !== 'ACTIVE' ? 'EXPIRED' : 'ISSUED',
      mofRef: `MoF/ML/2026/${seq}`, mofExpiry: o.mofExpiry ?? addYears(today(), 1), validUntil: o.validUntil ?? addDays(addYears(today(), 1), -1),
      contactName: `Contact ${seq}`, contactPhone: '0971234567', contactEmail: email, joinedAt: addYears(today(), -1),
    },
  });
  await prisma.user.create({ data: { email, name: `Contact ${seq}`, role: 'MEMBER', memberId: m.id, passwordHash: await hashPassword(PASSWORD) } });
  return { ...m, email };
}

/** Finds the most recent queued email to an address that carries a link token, and returns the token. */
export async function tokenFromEmail(to: string, param = 'token') {
  const n = await prisma.notification.findFirst({ where: { to, channel: 'EMAIL', body: { contains: `${param}=` } }, orderBy: { createdAt: 'desc' } });
  const match = n?.body.match(new RegExp(`[?&]${param}=([\\w-]+)`));
  if (!match) throw new Error(`No ${param} in the latest email to ${to}`);
  return match[1];
}
