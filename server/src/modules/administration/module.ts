import type { AppModule } from '../../shared/module.js';
import admin from './presentation/admin-routes.js';

export const administrationModule: AppModule = { name: 'administration', routes: { admin } };
