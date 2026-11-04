import type { AppModule } from '../../shared/module.js';
import auth from './presentation/auth-routes.js';
import admin from './presentation/staff-routes.js';

export const identityModule: AppModule = { name: 'identity', routes: { auth, admin } };
