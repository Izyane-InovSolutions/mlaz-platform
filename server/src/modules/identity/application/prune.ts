import { prisma } from '../../../shared/db.js';

/**
 * Deletes sign-in records nobody can use any more: sessions past their deadline (with their refresh tokens) after a
 * 30-day grace kept for investigating, emailed codes, and throttle counters idle for a day with no block in force.
 * Run nightly by the job scheduler.
 */
export async function pruneAuthRecords() {
  const day = 864e5, now = Date.now();
  const sessions = await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date(now - 30 * day) } } });
  const legacy = await prisma.refreshToken.deleteMany({ where: { sessionId: null, expiresAt: { lt: new Date(now - 30 * day) } } });
  const codes = await prisma.userToken.deleteMany({ where: { purpose: 'LOGIN_CHALLENGE', expiresAt: { lt: new Date(now - day) } } });
  const throttles = await prisma.loginThrottle.deleteMany({
    where: { windowStart: { lt: new Date(now - day) }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now - day) } }] },
  });
  return { sessions: sessions.count, refreshTokens: legacy.count, codes: codes.count, throttles: throttles.count };
}
