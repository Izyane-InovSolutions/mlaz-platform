import type { AppModule } from '../../shared/module.js';
import { paymentsAdminRoutes, paymentsPortalRoutes, paymentsWebhookRoutes } from './presentation/routes.js';

export const paymentsModule: AppModule = {
  name: 'payments',
  routes: { admin: paymentsAdminRoutes, portal: paymentsPortalRoutes, webhooks: paymentsWebhookRoutes },
};
