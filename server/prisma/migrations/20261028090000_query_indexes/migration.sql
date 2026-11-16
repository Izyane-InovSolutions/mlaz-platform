-- Indexes for queries that scanned whole tables: per-account email caps and newest-link lookups (UserToken),
-- broadcast delivery counts (Notification), and the nightly membership scans (Member). The new Member index on
-- (status, validUntil) also serves every lookup by status alone, so the single-column index is dropped.
-- DropIndex
DROP INDEX "Member_status_idx";

-- CreateIndex
CREATE INDEX "Member_status_validUntil_idx" ON "Member"("status", "validUntil");

-- CreateIndex
CREATE INDEX "Member_mofStatus_mofExpiry_idx" ON "Member"("mofStatus", "mofExpiry");

-- CreateIndex
CREATE INDEX "Notification_broadcastId_idx" ON "Notification"("broadcastId");

-- CreateIndex
CREATE INDEX "UserToken_userId_purpose_createdAt_idx" ON "UserToken"("userId", "purpose", "createdAt");
