import type { AppModule } from '../../shared/module.js';
import { documentsAdminRoutes, documentsPortalRoutes } from './presentation/routes.js';

export const documentsModule: AppModule = { name: 'documents', routes: { admin: documentsAdminRoutes, portal: documentsPortalRoutes } };
