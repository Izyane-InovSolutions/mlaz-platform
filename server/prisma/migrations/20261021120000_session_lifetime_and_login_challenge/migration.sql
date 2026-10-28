-- Absolute session lifetime (AuthSession), progressive sign-in throttling (strikes) and emailed sign-in codes.
-- Additive only: no column or row is dropped.

-- AlterEnum
ALTER TYPE "TokenPurpose" ADD VALUE 'LOGIN_CHALLENGE';

-- AlterTable
ALTER TABLE "LoginThrottle" ADD COLUMN     "strikes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "sessionId" TEXT;

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Refresh tokens issued before this migration have no session, so their absolute deadline is unknown. Revoke them
-- (users sign in once more) rather than let them live on without one. Rows are kept for the audit trail.
UPDATE "RefreshToken" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;
