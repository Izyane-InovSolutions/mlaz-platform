import type { AppModule } from '../shared/module.js';
import { administrationModule } from '../modules/administration/module.js';
import { applicationSettlement } from '../modules/applications/index.js';
import { applicationsModule } from '../modules/applications/module.js';
import { auditModule } from '../modules/audit/module.js';
import { provideAudienceDirectory } from '../modules/communications/index.js';
import { communicationsModule } from '../modules/communications/module.js';
import { documentsModule } from '../modules/documents/module.js';
import { eventSettlement } from '../modules/events/index.js';
import { eventsModule } from '../modules/events/module.js';
import { financeModule } from '../modules/finance/module.js';
import { identityModule } from '../modules/identity/module.js';
import { lendingModule } from '../modules/lending/module.js';
import { duesSettlement, memberAudiences } from '../modules/membership/index.js';
import { membershipModule } from '../modules/membership/module.js';
import { registerSettlementHandler } from '../modules/payments/index.js';
import { paymentsModule } from '../modules/payments/module.js';
import { reportingModule } from '../modules/reporting/module.js';

// The composition root: every module of the API, and the connections between modules that are made by injection
// rather than by import (so that the lower module does not depend on the higher one). See docs/architecture.md.

export const MODULES: readonly AppModule[] = [
  identityModule, administrationModule, auditModule, documentsModule, communicationsModule, membershipModule,
  applicationsModule, paymentsModule, eventsModule, financeModule, lendingModule, reportingModule,
];

let wired = false;

/**
 * Connects the ports. Idempotent; called by buildApp(), by the job scheduler and by the test setup, so whichever
 * starts first, a payment can never settle (and a broadcast never be sent) before its handler is in place.
 */
export function wireModules() {
  if (wired) return;
  // What a payment's outcome does, per purpose. Payments depends on none of these modules.
  registerSettlementHandler('APPLICATION', applicationSettlement);
  registerSettlementHandler('DUES', duesSettlement);
  registerSettlementHandler('EVENT', eventSettlement);
  // Who a broadcast reaches. Communications does not depend on membership.
  provideAudienceDirectory(memberAudiences);
  wired = true;
}
