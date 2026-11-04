import { sha256 } from '../../../shared/tokens.js';

// Password guessing is limited in layers. Every counter lives in Postgres and is updated with one atomic statement, so
// all API instances share the same numbers and parallel requests cannot slip past a limit (attempts are counted
// *before* the password is checked; a success hands its attempt back).
//  - Per address, across all accounts: 50 in 15 minutes (one password sprayed over many emails).
//  - Per account and address: 5 in 15 minutes. From a device that has signed in to the account before (device cookie),
//    the device is counted instead of the address, so someone sharing the user's network cannot block them.
//  - Per account from unrecognised devices, across all addresses: 10 in 15 minutes switch the account to "challenge"
//    for an hour. Nobody is locked out by it: a correct password from an unrecognised device must then be confirmed
//    with a code emailed to the account (or the authenticator app, if enrolled). Recognised devices sign in as usual.
// Blocks are temporary and grow with each repeat within a day (1, 4, 16, then at most 60 minutes). Keys hash the
// canonical email, so an unknown email is throttled exactly like a real one and case or spacing changes do not help.
export const WINDOW_MINUTES = 15, CHALLENGE_MINUTES = 60, CODE_MINUTES = 10;
// Emails an account can be sent per hour, whoever asks and from however many addresses: password-reset links and
// sign-in codes. Each new one cancels the previous one, so without a cap a flood would also keep the owner's link dead.
export const LIMITS = { address: 50, source: 5, device: 5, account: 10, code: 5, resetEmails: 3, signInCodes: 5 } as const;
export const BLOCK_MINUTES = [1, 4, 16, 60];

const h = (s: string) => sha256(s);
export const addressKey = (ip: string) => `ip:${h(ip)}`;
export const sourceKey = (email: string, ip: string) => `login:${h(email)}:${h(ip)}`;
export const sourcePrefix = (email: string) => `login:${h(email)}:`;
export const deviceKey = (nonce: string) => `device:${h(nonce)}`;
export const accountKey = (email: string) => `account:${h(email)}`;
// Authenticator-code attempts. Replay prevention is per user (the code belongs to the user's secret: totpLastStep), but
// the attempt counters are split so that guessing cannot block the owner (as for passwords):
//  - per sign-in step (the mfa token): 5 tries, and a step that succeeded or ran out cannot be used again;
//  - per account from unrecognised devices: 5 tries in 15 minutes, the ceiling across every step a password holder
//    can start; a device that has signed in to the account before is counted on its own instead;
//  - per session for the code that confirms a sensitive change (turning 2FA off, new recovery codes).
export const mfaKey = (userId: string) => `mfa:${userId}`;
export const mfaStepKey = (stepId: string) => `mfa-step:${h(stepId)}`;
export const mfaDeviceKey = (nonce: string) => `mfa-device:${h(nonce)}`;
export const mfaSessionKey = (sessionId: string) => `mfa-session:${sessionId}`;
/** How long the password step's proof (the mfa token) lasts. */
export const MFA_STEP_MINUTES = 10;
export const codeKey = (challenge: string) => `code:${h(challenge)}`;
