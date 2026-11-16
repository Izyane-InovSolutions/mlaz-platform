-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBERSHIP_OFFICER', 'FINANCE_OFFICER', 'COMMS_OFFICER', 'MEMBER');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('INVITE', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'LAPSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AccreditationStatus" AS ENUM ('ISSUED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "MofStatus" AS ENUM ('VALID', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SuspensionKind" AS ENUM ('MOF_EXPIRED', 'STAFF');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('VALID', 'SUPERSEDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('DETAILS', 'MOF_REVIEW', 'PAYMENT_PENDING', 'ACCREDITED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('MOF_AUTHORIZATION', 'PACRA_CERTIFICATE', 'DIRECTOR_NRC', 'PROOF_OF_PAYMENT', 'RESOURCE');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('APPLICATION', 'DUES', 'EVENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MTN_MOMO', 'AIRTEL_MONEY', 'ZAMTEL_KWACHA', 'IZYANE_QR', 'CARD', 'BANK_TRANSFER', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LineType" AS ENUM ('JOINING_FEE', 'DUES', 'EVENT_TICKET');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('TRAINING', 'WEBINAR', 'AGM', 'NETWORKING');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('CURRENT', 'ARREARS', 'CLOSED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('STAFF', 'MEMBER', 'APPLICANT', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "memberId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tier" (
    "name" TEXT NOT NULL,
    "annualDues" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "town" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "tpin" TEXT NOT NULL,
    "pacra" TEXT NOT NULL DEFAULT '',
    "tierName" TEXT NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "accreditation" "AccreditationStatus" NOT NULL DEFAULT 'ISSUED',
    "suspension" "SuspensionKind",
    "suspensionReason" TEXT,
    "mofStatus" "MofStatus" NOT NULL DEFAULT 'VALID',
    "mofRef" TEXT NOT NULL,
    "mofExpiry" DATE,
    "validUntil" DATE NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "joinedAt" DATE NOT NULL,
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberActivity" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATE NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'VALID',

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MofRenewal" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "mofRef" TEXT NOT NULL,
    "documentId" TEXT,
    "status" "RenewalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "MofRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuesPayment" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuesPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "town" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "pacra" TEXT NOT NULL,
    "tpin" TEXT NOT NULL,
    "tierName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "directorName" TEXT NOT NULL,
    "directorNrc" TEXT NOT NULL,
    "mofRef" TEXT,
    "mofExpiry" DATE,
    "stage" "ApplicationStage" NOT NULL,
    "returnNote" TEXT,
    "rejectionReason" TEXT,
    "recommendedById" TEXT,
    "recommendedAt" TIMESTAMP(3),
    "recommendationNote" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "applicationId" TEXT,
    "memberId" TEXT,
    "paymentId" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "superseded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "applicationId" TEXT,
    "memberId" TEXT,
    "registrationId" TEXT,
    "payerName" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "msisdn" TEXT,
    "checkoutUrl" TEXT,
    "qrPayload" TEXT,
    "bankRef" TEXT,
    "failureReason" TEXT,
    "recordedBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLine" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "type" "LineType" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PaymentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "date" DATE NOT NULL,
    "venue" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "capacity" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PUBLISHED',
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tickets" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "RegistrationStatus" NOT NULL,
    "refundDue" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "channels" TEXT[],
    "recipientCount" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sendAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "broadcastId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "eventId" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "borrowerNrc" TEXT NOT NULL,
    "borrowerName" TEXT NOT NULL,
    "borrowerPhone" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'CURRENT',
    "issuedAt" DATE NOT NULL,
    "lastScore" INTEGER,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditCheck" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nrc" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "consent" BOOLEAN NOT NULL,
    "found" BOOLEAN NOT NULL,
    "score" INTEGER,
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "ip" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_memberId_idx" ON "User"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserToken_tokenHash_key" ON "UserToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Member_number_key" ON "Member"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Member_applicationId_key" ON "Member"("applicationId");

-- CreateIndex
CREATE INDEX "Member_status_idx" ON "Member"("status");

-- CreateIndex
CREATE INDEX "Member_tierName_idx" ON "Member"("tierName");

-- CreateIndex
CREATE INDEX "Member_province_idx" ON "Member"("province");

-- CreateIndex
CREATE INDEX "MemberActivity_memberId_at_idx" ON "MemberActivity"("memberId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_serial_key" ON "Certificate"("serial");

-- CreateIndex
CREATE INDEX "Certificate_memberId_idx" ON "Certificate"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MofRenewal_documentId_key" ON "MofRenewal"("documentId");

-- CreateIndex
CREATE INDEX "MofRenewal_status_idx" ON "MofRenewal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DuesPayment_paymentId_key" ON "DuesPayment"("paymentId");

-- CreateIndex
CREATE INDEX "DuesPayment_memberId_idx" ON "DuesPayment"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_memberId_key_key" ON "ReminderLog"("memberId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Application_ref_key" ON "Application"("ref");

-- CreateIndex
CREATE INDEX "Application_stage_idx" ON "Application"("stage");

-- CreateIndex
CREATE INDEX "Application_tpin_idx" ON "Application"("tpin");

-- CreateIndex
CREATE INDEX "Application_pacra_idx" ON "Application"("pacra");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_applicationId_idx" ON "Document"("applicationId");

-- CreateIndex
CREATE INDEX "Document_memberId_idx" ON "Document"("memberId");

-- CreateIndex
CREATE INDEX "Document_paymentId_idx" ON "Document"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_ref_key" ON "Payment"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_registrationId_key" ON "Payment"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerRef_key" ON "Payment"("providerRef");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_memberId_idx" ON "Payment"("memberId");

-- CreateIndex
CREATE INDEX "Payment_applicationId_idx" ON "Payment"("applicationId");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_name_key" ON "Event"("name");

-- CreateIndex
CREATE INDEX "Event_date_idx" ON "Event"("date");

-- CreateIndex
CREATE INDEX "Registration_eventId_status_idx" ON "Registration"("eventId", "status");

-- CreateIndex
CREATE INDEX "Registration_memberId_idx" ON "Registration"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_documentId_key" ON "Resource"("documentId");

-- CreateIndex
CREATE INDEX "Notification_status_sendAfter_idx" ON "Notification"("status", "sendAfter");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_ref_key" ON "Expense"("ref");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Loan_memberId_idx" ON "Loan"("memberId");

-- CreateIndex
CREATE INDEX "Loan_borrowerNrc_idx" ON "Loan"("borrowerNrc");

-- CreateIndex
CREATE INDEX "CreditCheck_memberId_createdAt_idx" ON "CreditCheck"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditCheck_nrc_idx" ON "CreditCheck"("nrc");

-- CreateIndex
CREATE INDEX "AuditLog_target_idx" ON "AuditLog"("target");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_tierName_fkey" FOREIGN KEY ("tierName") REFERENCES "Tier"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberActivity" ADD CONSTRAINT "MemberActivity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MofRenewal" ADD CONSTRAINT "MofRenewal_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MofRenewal" ADD CONSTRAINT "MofRenewal_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesPayment" ADD CONSTRAINT "DuesPayment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesPayment" ADD CONSTRAINT "DuesPayment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tierName_fkey" FOREIGN KEY ("tierName") REFERENCES "Tier"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_recommendedById_fkey" FOREIGN KEY ("recommendedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditCheck" ADD CONSTRAINT "CreditCheck_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
