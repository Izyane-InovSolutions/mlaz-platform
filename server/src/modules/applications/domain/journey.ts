// Application journey: DETAILS → MOF_REVIEW → (recommended by a maker, approved by a different checker) → PAYMENT_PENDING
// → ACCREDITED (automatically, when payment succeeds). Staff can return an application to DETAILS or reject it.
// The same values as the Prisma enum ApplicationStage, kept here so the rules need no database code.

export type ApplicationStage = 'DETAILS' | 'MOF_REVIEW' | 'PAYMENT_PENDING' | 'ACCREDITED' | 'REJECTED';

export const OPEN_STAGES: ApplicationStage[] = ['DETAILS', 'MOF_REVIEW', 'PAYMENT_PENDING'];
export const isOpen = (stage: ApplicationStage) => OPEN_STAGES.includes(stage);

/** What the console shows for a stage: an application in MoF review with a recommendation is "awaiting approval". */
export const displayStage = (a: { stage: ApplicationStage; recommendedById: string | null }) =>
  (a.stage === 'MOF_REVIEW' && a.recommendedById ? 'AWAITING_APPROVAL' : a.stage);

/** Maker/checker: the officer who recommended an application may not also approve it. */
export const isOwnRecommendation = (a: { recommendedById: string | null }, approverId: string) => a.recommendedById === approverId;

/* ---------- automated checks for the reviewing officer ---------- */

interface Identity { tpin: string; pacra: string; name: string; email: string; phone: string }

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = (v: string) => v.replace(/\D/g, '').slice(-9);

/** Which identifying details of another member or application match this applicant's. */
export const matchingFields = (a: Identity, r: Identity) => [
  r.tpin === a.tpin && 'TPIN', r.pacra && r.pacra === a.pacra && 'PACRA no.', norm(r.name) === norm(a.name) && 'business name',
  r.email.toLowerCase() === a.email.toLowerCase() && 'email', digits(r.phone) === digits(a.phone) && 'phone',
].filter((x): x is string => !!x);

/** Documents an application must have at its stage: the MoF authorization only once it is past DETAILS. */
export const requiredDocuments = (stage: ApplicationStage) => ['PACRA_CERTIFICATE', 'DIRECTOR_NRC', ...(stage === 'DETAILS' ? [] : ['MOF_AUTHORIZATION'])];

export const tpinLooksValid = (tpin: string) => /^\d{10}$/.test(tpin); // placeholder until the ZRA TPIN lookup is connected

export const checkFlags = (c: { tpinValid: boolean; duplicates: number; missingDocuments: number }) =>
  [!c.tpinValid && 'TPIN not verified', c.duplicates && 'possible duplicate', c.missingDocuments && 'documents incomplete'].filter((x): x is string => !!x);

/** A recommendation despite flagged checks needs a note explaining why. */
export const MIN_JUSTIFICATION = 10;
