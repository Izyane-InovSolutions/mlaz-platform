import type { AppModule } from '../../shared/module.js';
import { applicationsAdminRoutes, applicationsPublicRoutes } from './presentation/routes.js';

export const applicationsModule: AppModule = { name: 'applications', routes: { admin: applicationsAdminRoutes, public: applicationsPublicRoutes } };
