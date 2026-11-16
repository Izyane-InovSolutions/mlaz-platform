// Identity and access: users, sessions, sign-in protection, two-factor sign-in, staff accounts and RBAC.
// Public interface for other modules' application layers.
export { ROLE_LABEL, type Role, STAFF_ROLES, can, isStaffRole } from './domain/roles.js';
export { type AuthUser, canonicalEmail } from './domain/users.js';
export { LIMITS } from './domain/throttle-policy.js';
export { RESET_MIN_MS, emailTaken, inviteUser, sendInvite } from './application/passwords.js';
export { pruneAuthRecords } from './application/prune.js';
export { memberPortalUsers, setMemberUserActive } from './application/staff.js';
export { hashPassword } from './infrastructure/password-hasher.js';
