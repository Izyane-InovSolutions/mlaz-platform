import type { AppModule } from '../../shared/module.js';
import { communicationsAdminRoutes, communicationsPortalRoutes, communicationsPublicRoutes } from './presentation/routes.js';

export const communicationsModule: AppModule = {
  name: 'communications',
  routes: { admin: communicationsAdminRoutes, portal: communicationsPortalRoutes, public: communicationsPublicRoutes },
};
