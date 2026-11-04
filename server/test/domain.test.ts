// Unit tests for the business rules in each module's domain layer: pure functions, no database or HTTP. The integration
// tests (applications, payments, membership...) cover the same rules end to end; these pin down the edge cases.
import { describe, expect, it } from 'vitest';
import { checkFlags, displayStage, isOwnRecommendation, matchingFields, requiredDocuments } from '../src/modules/applications/domain/journey.js';
import { can, isStaffRole, permissionsFor } from '../src/modules/identity/domain/roles.js';
import { canonicalEmail, checkPasswordForUser, isAllowedStaffEmail, passwordSchema } from '../src/modules/identity/domain/users.js';
import { rating } from '../src/modules/lending/domain/credit-scores.js';
import { certificateSerial, certificateSerialBase, firstDuesPeriod, inGoodStanding, nextDuesPeriod } from '../src/modules/membership/domain/standing.js';
import { EXPIRED_REASON, REPLACED_REASON, UNREACHABLE_REASON, amountMatches, isLateSuccess, priceLines } from '../src/modules/payments/domain/payment-rules.js';
import { settlementHandler } from '../src/modules/payments/application/settlement-handlers.js';
import { dateOnly, isoDate } from '../src/shared/dates.js';

describe('payments: settlement rules', () => {
  const gave = (failureReason: string | null, status: 'FAILED' | 'CANCELLED' = 'FAILED', provider = 'sandbox') => ({ provider, status, failureReason });

  it('honours a late success only for payments the server gave up on, never for staff records or real failures', () => {
    for (const reason of [EXPIRED_REASON, REPLACED_REASON, UNREACHABLE_REASON]) expect(isLateSuccess(gave(reason), 'SUCCESS')).toBe(true);
    expect(isLateSuccess(gave(REPLACED_REASON, 'CANCELLED'), 'SUCCESS')).toBe(true);
    expect(isLateSuccess(gave('Declined by the payer'), 'SUCCESS')).toBe(false);
    expect(isLateSuccess(gave(EXPIRED_REASON, 'FAILED', 'manual'), 'SUCCESS')).toBe(false);
    expect(isLateSuccess(gave(EXPIRED_REASON), 'FAILED')).toBe(false);
    expect(isLateSuccess({ provider: 'sandbox', status: 'SUCCESS', failureReason: null }, 'SUCCESS')).toBe(false);
  });

  it('matches webhook amounts to the ngwee', () => {
    expect(amountMatches(4500, 4500)).toBe(true);
    expect(amountMatches(4500, 4500.004)).toBe(true);
    expect(amountMatches(4500, 4500.01)).toBe(false);
    expect(amountMatches(4500, 450)).toBe(false);
  });

  it('prices lines with quantities and rounds to the ngwee', () => {
    expect(priceLines([{ type: 'EVENT_TICKET', description: 'x', quantity: 3, unitAmount: 33.335 }])[0]).toMatchObject({ quantity: 3, amount: 100.01 });
    expect(priceLines([{ type: 'DUES', description: 'd', unitAmount: 1800 }])[0]).toMatchObject({ quantity: 1, amount: 1800 });
  });
});

describe('membership: standing and dues periods', () => {
  const t = dateOnly('2026-11-03');
  const member = (o: Partial<Parameters<typeof inGoodStanding>[0]> = {}) =>
    ({ status: 'ACTIVE', accreditation: 'ISSUED', mofStatus: 'VALID', validUntil: dateOnly('2099-01-01'), ...o }) as Parameters<typeof inGoodStanding>[0];

  it('is in good standing only when active, accredited, MoF-valid and paid up', () => {
    expect(inGoodStanding(member())).toBe(true);
    expect(inGoodStanding(member({ status: 'LAPSED' }))).toBe(false);
    expect(inGoodStanding(member({ accreditation: 'REVOKED' }))).toBe(false);
    expect(inGoodStanding(member({ mofStatus: 'EXPIRED' }))).toBe(false);
    expect(inGoodStanding(member({ validUntil: dateOnly('2000-01-01') }))).toBe(false);
  });

  it('a dues payment extends the current period by a year, or starts a year from today once it has ended', () => {
    const ongoing = nextDuesPeriod(dateOnly('2026-12-31'), t);
    expect([isoDate(ongoing.periodStart), isoDate(ongoing.periodEnd)]).toEqual(['2027-01-01', '2027-12-31']);
    const ended = nextDuesPeriod(dateOnly('2026-10-01'), t);
    expect([isoDate(ended.periodStart), isoDate(ended.periodEnd)]).toEqual(['2026-11-03', '2027-11-02']);
    const first = firstDuesPeriod(t);
    expect([isoDate(first.periodStart), isoDate(first.periodEnd)]).toEqual(['2026-11-03', '2027-11-02']);
  });

  it('numbers certificates per member and year', () => {
    const base = certificateSerialBase('MLA-0428', t);
    expect(base).toBe('MLAZ/ACC/0428/26');
    expect(certificateSerial(base, 0)).toBe('MLAZ/ACC/0428/26');
    expect(certificateSerial(base, 2)).toBe('MLAZ/ACC/0428/26-3');
  });
});

describe('applications: journey and checks', () => {
  it('shows a recommended application in MoF review as awaiting approval', () => {
    expect(displayStage({ stage: 'MOF_REVIEW', recommendedById: 'u1' })).toBe('AWAITING_APPROVAL');
    expect(displayStage({ stage: 'MOF_REVIEW', recommendedById: null })).toBe('MOF_REVIEW');
    expect(displayStage({ stage: 'PAYMENT_PENDING', recommendedById: 'u1' })).toBe('PAYMENT_PENDING');
  });

  it('maker/checker: the recommending officer is recognised as such', () => {
    expect(isOwnRecommendation({ recommendedById: 'u1' }, 'u1')).toBe(true);
    expect(isOwnRecommendation({ recommendedById: 'u1' }, 'u2')).toBe(false);
  });

  it('finds duplicates by TPIN, PACRA, name (ignoring case and punctuation), email and phone (last 9 digits)', () => {
    const a = { tpin: '1000000001', pacra: '120260000001', name: 'Quick Lend Ltd.', email: 'Info@Quick.zm', phone: '+260 97 123 4567' };
    expect(matchingFields(a, { ...a, name: 'quicklend ltd', email: 'info@quick.zm', phone: '0971234567' })).toEqual(['TPIN', 'PACRA no.', 'business name', 'email', 'phone']);
    expect(matchingFields(a, { tpin: '2', pacra: '', name: 'Other', email: 'x@y.zm', phone: '0961111111' })).toEqual([]);
  });

  it('asks for the MoF authorization only once an application is past the details stage', () => {
    expect(requiredDocuments('DETAILS')).not.toContain('MOF_AUTHORIZATION');
    expect(requiredDocuments('MOF_REVIEW')).toContain('MOF_AUTHORIZATION');
    expect(checkFlags({ tpinValid: false, duplicates: 1, missingDocuments: 2 })).toEqual(['TPIN not verified', 'possible duplicate', 'documents incomplete']);
    expect(checkFlags({ tpinValid: true, duplicates: 0, missingDocuments: 0 })).toEqual([]);
  });
});

describe('identity: roles and password policy', () => {
  it('keeps maker and checker apart: only the admin approves, officers recommend', () => {
    expect(can('ADMIN', 'applications:approve')).toBe(true);
    expect(can('MEMBERSHIP_OFFICER', 'applications:recommend')).toBe(true);
    expect(can('MEMBERSHIP_OFFICER', 'applications:approve')).toBe(false);
    expect(can('FINANCE_OFFICER', 'applications:recommend')).toBe(false);
    expect(can('COMMS_OFFICER', 'payments:read')).toBe(false);
    expect(permissionsFor('MEMBER')).toEqual([]);
    expect(isStaffRole('MEMBER')).toBe(false);
  });

  it('refuses common, repetitive and email-derived passwords', () => {
    expect(passwordSchema.safeParse('password1234').success).toBe(false);
    expect(passwordSchema.safeParse('aaaaaaaaaaaa').success).toBe(false);
    expect(passwordSchema.safeParse('Correct-Horse-9').success).toBe(true);
    expect(checkPasswordForUser('chanda-2026-pass', 'chanda@example.zm')).toBe(false);
    expect(checkPasswordForUser('Correct-Horse-9', 'chanda@example.zm')).toBe(true);
  });

  it('limits staff accounts to the association domain, and canonicalises emails for throttling', () => {
    expect(isAllowedStaffEmail('officer@mlaz.org.zm', 'MEMBERSHIP_OFFICER', '@mlaz.org.zm')).toBe(true);
    expect(isAllowedStaffEmail('officer@gmail.com', 'MEMBERSHIP_OFFICER', 'mlaz.org.zm')).toBe(false);
    expect(isAllowedStaffEmail('owner@gmail.com', 'MEMBER', 'mlaz.org.zm')).toBe(true);
    expect(isAllowedStaffEmail('anyone@gmail.com', 'ADMIN', '')).toBe(true);
    expect(canonicalEmail('  Info@QuickLend.ZM ')).toBe('info@quicklend.zm');
  });
});

describe('lending: score rating', () => {
  it('rates 600 and above as good', () => {
    expect(rating(600)).toBe('GOOD');
    expect(rating(599)).toBe('BAD');
  });
});

describe('module wiring (platform/modules.ts)', () => {
  it('every payment purpose has a settlement handler, so no payment settles without applying what it paid for', () => {
    for (const purpose of ['APPLICATION', 'DUES', 'EVENT'] as const) {
      const h = settlementHandler(purpose);
      expect(typeof h.paid).toBe('function');
      expect(typeof h.released).toBe('function');
    }
  });

  it('a purpose without a handler fails loudly instead of settling', () => {
    expect(() => settlementHandler('UNKNOWN' as never)).toThrow(/No settlement handler/);
  });
});
