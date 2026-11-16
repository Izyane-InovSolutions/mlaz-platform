-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "refundRef" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedBy" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "recoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sessionsValidAfter" TIMESTAMP(3),
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);
