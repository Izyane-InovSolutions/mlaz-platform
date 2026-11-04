// Roles and permissions (RBAC). The same values as the Prisma enum Role, kept here so the rules need no database code.

export type Role = 'ADMIN' | 'MEMBERSHIP_OFFICER' | 'FINANCE_OFFICER' | 'COMMS_OFFICER' | 'MEMBER';
export type StaffRole = Exclude<Role, 'MEMBER'>;
export const STAFF_ROLES = ['ADMIN', 'MEMBERSHIP_OFFICER', 'FINANCE_OFFICER', 'COMMS_OFFICER'] as const satisfies readonly StaffRole[];

export const PERMISSIONS = [
  'dashboard:view',
  'members:read', 'members:write',
  'applications:read', 'applications:recommend', 'applications:approve', 'applications:return',
  'renewals:verify',
  'documents:read',
  'payments:read', 'payments:confirm', 'payments:record',
  'expenses:read', 'expenses:write',
  'events:read', 'events:write',
  'comms:write',
  'reports:read',
  'settings:write',
  'staff:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// The Secretariat Admin is the checker: only they approve a recommendation, and never their own.
const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  MEMBERSHIP_OFFICER: [
    'dashboard:view', 'members:read', 'members:write', 'applications:read', 'applications:recommend', 'applications:return',
    'renewals:verify', 'documents:read', 'payments:read', 'events:read', 'reports:read',
  ],
  FINANCE_OFFICER: [
    'dashboard:view', 'members:read', 'applications:read', 'documents:read', 'payments:read', 'payments:confirm', 'payments:record',
    'expenses:read', 'expenses:write', 'events:read', 'reports:read',
  ],
  COMMS_OFFICER: ['dashboard:view', 'members:read', 'events:read', 'events:write', 'comms:write', 'reports:read'],
};

export const isStaffRole = (role: Role): role is StaffRole => role !== 'MEMBER';
export const permissionsFor = (role: Role): readonly Permission[] => (isStaffRole(role) ? ROLE_PERMISSIONS[role] : []);
export const can = (role: Role, p: Permission) => permissionsFor(role).includes(p);

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Secretariat Admin',
  MEMBERSHIP_OFFICER: 'Membership Officer',
  FINANCE_OFFICER: 'Finance Officer',
  COMMS_OFFICER: 'Communications Officer',
  MEMBER: 'Member',
};
