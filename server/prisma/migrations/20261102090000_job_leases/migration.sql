-- Leases for background jobs that must run on one API instance at a time (payment reconciliation). Additive only:
-- a new, empty table, so it is safe for a rolling deploy. To reverse it: DROP TABLE "JobLease";
-- CreateTable
CREATE TABLE "JobLease" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("name")
);
