import type { AppModule } from '../../shared/module.js';
import { eventsAdminRoutes, eventsPortalRoutes, eventsPublicRoutes } from './presentation/routes.js';

export const eventsModule: AppModule = { name: 'events', routes: { admin: eventsAdminRoutes, portal: eventsPortalRoutes, public: eventsPublicRoutes } };
