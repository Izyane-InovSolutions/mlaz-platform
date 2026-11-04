-- DropIndex
DROP INDEX "AuditLog_target_idx";

-- CreateIndex
CREATE INDEX "AuditLog_target_at_idx" ON "AuditLog"("target", "at");

-- CreateIndex
CREATE INDEX "MofRenewal_memberId_status_idx" ON "MofRenewal"("memberId", "status");

-- CreateIndex
CREATE INDEX "Payment_status_paidAt_idx" ON "Payment"("status", "paidAt");

