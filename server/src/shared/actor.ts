/** Who did something. Every use case that changes data takes one, so the audit trail always names a person. */
export interface Actor {
  type: 'STAFF' | 'MEMBER' | 'APPLICANT' | 'SYSTEM';
  id?: string;
  label: string;
  ip?: string;
}

export const SYSTEM: Actor = { type: 'SYSTEM', label: 'System' };
export const applicantActor = (contactName: string, ip?: string): Actor => ({ type: 'APPLICANT', label: `${contactName} (applicant)`, ip });
