import type { AppModule } from '../../shared/module.js';
import { reportingAdminRoutes, reportingPortalRoutes, reportingPublicRoutes } from './presentation/routes.js';

export const reportingModule: AppModule = { name: 'reporting', routes: { admin: reportingAdminRoutes, portal: reportingPortalRoutes, public: reportingPublicRoutes } };
