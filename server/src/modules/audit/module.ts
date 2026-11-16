import type { AppModule } from '../../shared/module.js';
import admin from './presentation/admin-routes.js';

export const auditModule: AppModule = { name: 'audit', routes: { admin } };
