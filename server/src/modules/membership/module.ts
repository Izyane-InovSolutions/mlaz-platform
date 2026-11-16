import type { AppModule } from '../../shared/module.js';
import { membershipAdminRoutes, membershipPortalRoutes, membershipPublicRoutes } from './presentation/routes.js';

export const membershipModule: AppModule = {
  name: 'membership',
  routes: { admin: membershipAdminRoutes, portal: membershipPortalRoutes, public: membershipPublicRoutes },
};
