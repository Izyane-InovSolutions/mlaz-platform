import { z } from 'zod';
import type { Actor } from '../../../shared/actor.js';
import { ROLE_LABEL, type Role, isStaffRole } from './roles.js';

/** The signed-in user, as the session check loads it on every request. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  title: string | null;
  role: Role;
  memberId: string | null;
}

/** The one spelling of an email used for look-ups and throttling, so case, spacing or Unicode forms cannot dodge a limit. */
export const canonicalEmail = (email: string) => email.normalize('NFKC').trim().toLowerCase();

export const staffLabel = (u: Pick<AuthUser, 'name' | 'title' | 'role'>) => `${u.name} (${u.title || ROLE_LABEL[u.role]})`;

/** How a user appears in the audit trail. */
export function actorFor(u: Pick<AuthUser, 'id' | 'name' | 'title' | 'role'>, ip?: string): Actor {
  return isStaffRole(u.role)
    ? { type: 'STAFF', id: u.id, label: staffLabel(u), ip }
    : { type: 'MEMBER', id: u.id, label: `${u.name} (member)`, ip };
}

/* ---------- password policy ---------- */

// Common and guessable passwords are refused outright; length does most of the work.
const COMMON = new Set(['password1234', 'password12345', 'qwerty123456', '1234567890', '12345678910', 'iloveyou123', 'welcome1234', 'admin12345', 'letmein1234', 'zambia12345', 'lusaka12345', 'mlaz123456', 'changeme123', 'password@123', 'p@ssw0rd123']);
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200)
  .refine(p => !COMMON.has(p.toLowerCase()), 'That password is too common. Choose another.')
  .refine(p => new Set(p).size >= 5, 'Use a less repetitive password.');

/** Also refuses passwords built from the account's own email name. */
export function checkPasswordForUser(password: string, email: string) {
  const local = email.split('@')[0].toLowerCase();
  return !(local.length >= 4 && password.toLowerCase().includes(local));
}

/** Staff accounts may only use the association's email domain, when one is configured. */
export const isAllowedStaffEmail = (email: string, role: Role, staffDomain: string) => {
  const domain = staffDomain.toLowerCase().replace(/^@/, '');
  return !(domain && isStaffRole(role) && !email.toLowerCase().endsWith(`@${domain}`));
};
