// The bureau's score scale and what counts as a good score.
export const GOOD_SCORE = 600;
export const SCORE_MIN = 300, SCORE_MAX = 850;
export const SCALE = { min: SCORE_MIN, max: SCORE_MAX, good: GOOD_SCORE } as const;

export const isGood = (score: number) => score >= GOOD_SCORE;
export const rating = (score: number) => (isGood(score) ? 'GOOD' : 'BAD');

/** A member's own recent check of a borrower is reused for a new loan for this long, without another bureau enquiry. */
export const REUSE_CHECK_DAYS = 30;
