// Shortcuts through the API for the steps a spec is not about (creating an application, recommending it...), so each
// spec starts from the state it needs. The browser tests the step that matters.
import { type APIRequestContext, expect } from '@playwright/test';
import { API_URL, PASSWORD, UI_URL } from './env.ts';
import { FILES } from './files.ts';

export const pdf = () => FILES.pdf;

/** Signs in through the API and returns the access token (the browser keeps its own in memory, out of reach). */
export async function tokenFor(request: APIRequestContext, email: string, password = PASSWORD) {
  const res = await request.post(`${API_URL}/auth/login`, { data: { email, password } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).accessToken as string;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

let seq = 0;
/** Business details no other application or member shares, so the duplicate checks stay quiet. */
export function uniqueApplicant(label = 'Lenders') {
  const n = `${Date.now() % 1e7}`.padStart(7, '0') + String(++seq % 100).padStart(2, '0') + String(process.pid % 10);
  return {
    name: `E2E ${label} ${n}`,
    pacra: `12${n}0`.slice(0, 12).padEnd(12, '0'),
    tpin: `4${n}`.slice(0, 10),
    town: 'Lusaka',
    province: 'Lusaka',
    address: 'Plot 1, Cairo Road',
    tier: 'Silver',
    contact: 'Esther Mwale',
    position: 'Director',
    phone: `096${n.slice(-7)}`,
    email: `applicant.${n}@e2e-applicant.zm`,
    director: 'Esther Mwale',
    directorNrc: `${n.slice(0, 6)}/11/1`,
  };
}
export type Applicant = ReturnType<typeof uniqueApplicant>;

/** Submits an application through the public endpoint (multipart, real PDF files). */
export async function submitApplication(request: APIRequestContext, a: Applicant, { withMof = true } = {}) {
  const res = await request.post(`${API_URL}/public/applications`, {
    headers: { origin: UI_URL },
    multipart: {
      ...a, declare: 'true',
      ...(withMof ? { mofRef: `MoF/ML/2026/${a.tpin.slice(-4)}`, mofFile: pdf() } : {}),
      pacraFile: pdf(), nrcFile: pdf(),
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { ref: string; trackingToken: string; trackUrl: string; stage: string };
}

const nextYear = () => new Date(Date.now() + 300 * 864e5).toISOString().slice(0, 10);

export async function recommend(request: APIRequestContext, officerEmail: string, ref: string) {
  const res = await request.post(`${API_URL}/admin/applications/${ref}/recommend`, {
    headers: bearer(await tokenFor(request, officerEmail)), data: { mofExpiry: nextYear(), note: 'Authorization confirmed on the register.' },
  });
  expect(res.status(), await res.text()).toBe(200);
}

export async function approve(request: APIRequestContext, adminEmail: string, ref: string) {
  const res = await request.post(`${API_URL}/admin/applications/${ref}/approve`, { headers: bearer(await tokenFor(request, adminEmail)), data: {} });
  expect(res.status(), await res.text()).toBe(200);
}
