// Fixture accounts and members, created by seed.ts before every run. Each spec has its own accounts so specs can run
// in parallel without sharing sign-in throttles, sessions or dues state.

export const STAFF = {
  admin: { email: 'admin@mlaz.org.zm', name: 'Ada Admin', role: 'ADMIN' },
  officer: { email: 'officer@mlaz.org.zm', name: 'Oscar Officer', role: 'MEMBERSHIP_OFFICER' },
  finance: { email: 'finance@mlaz.org.zm', name: 'Fiona Finance', role: 'FINANCE_OFFICER' },
  comms: { email: 'comms@mlaz.org.zm', name: 'Cole Comms', role: 'COMMS_OFFICER' },
  mfaAdmin: { email: 'mfa.admin@mlaz.org.zm', name: 'Mona Mfa', role: 'ADMIN' },
  sessionOfficer: { email: 'session.officer@mlaz.org.zm', name: 'Sam Session', role: 'MEMBERSHIP_OFFICER' },
  expiryOfficer: { email: 'expiry.officer@mlaz.org.zm', name: 'Eve Expiry', role: 'MEMBERSHIP_OFFICER' },
  eventsOfficer: { email: 'events.officer@mlaz.org.zm', name: 'Evan Events', role: 'COMMS_OFFICER' },
  a11yAdmin: { email: 'a11y.admin@mlaz.org.zm', name: 'Alex Access', role: 'ADMIN' },
} as const;

/** dueInDays: days until the paid period ends (dues become payable 60 days before). */
export interface MemberFixture { key: string; number: string; name: string; email: string; dueInDays: number; certificate?: string; payment?: string }

export const MEMBERS = {
  duesOk: { key: 'duesOk', number: 'MLA-9001', name: 'Dues Paying Lenders', email: 'dues.ok@e2e-lender.zm', dueInDays: 30 },
  duesDeclined: { key: 'duesDeclined', number: 'MLA-9002', name: 'Declined Card Lenders', email: 'dues.declined@e2e-lender.zm', dueInDays: 30 },
  bankConfirm: { key: 'bankConfirm', number: 'MLA-9003', name: 'Bank Confirmed Lenders', email: 'bank.confirm@e2e-lender.zm', dueInDays: 20 },
  bankReject: { key: 'bankReject', number: 'MLA-9004', name: 'Bank Rejected Lenders', email: 'bank.reject@e2e-lender.zm', dueInDays: 20 },
  lender: { key: 'lender', number: 'MLA-9005', name: 'Credit Check Lenders', email: 'credit.lender@e2e-lender.zm', dueInDays: 300, certificate: 'MLAZ/ACC/9005/26' },
  permA: { key: 'permA', number: 'MLA-9006', name: 'Alpha Own Payments', email: 'perm.alpha@e2e-lender.zm', dueInDays: 300, payment: 'PAY-9601' },
  permB: { key: 'permB', number: 'MLA-9007', name: 'Bravo Other Payments', email: 'perm.bravo@e2e-lender.zm', dueInDays: 300, payment: 'PAY-9602' },
  sessionMember: { key: 'sessionMember', number: 'MLA-9008', name: 'Session Lenders', email: 'session.member@e2e-lender.zm', dueInDays: 300 },
  expiryMember: { key: 'expiryMember', number: 'MLA-9009', name: 'Idle Session Lenders', email: 'expiry.member@e2e-lender.zm', dueInDays: 300 },
  challengeMember: { key: 'challengeMember', number: 'MLA-9010', name: 'Challenged Sign-in Lenders', email: 'challenge.member@e2e-lender.zm', dueInDays: 300 },
  cardPayer: { key: 'cardPayer', number: 'MLA-9011', name: 'Card Checkout Lenders', email: 'card.payer@e2e-lender.zm', dueInDays: 30 },
  qrPayer: { key: 'qrPayer', number: 'MLA-9012', name: 'QR Checkout Lenders', email: 'qr.payer@e2e-lender.zm', dueInDays: 30 },
  eventGoer: { key: 'eventGoer', number: 'MLA-9013', name: 'Event Going Lenders', email: 'event.goer@e2e-lender.zm', dueInDays: 300 },
  a11yMember: { key: 'a11yMember', number: 'MLA-9014', name: 'Accessible Portal Lenders', email: 'a11y.member@e2e-lender.zm', dueInDays: 300 },
} as const satisfies Record<string, MemberFixture>;
