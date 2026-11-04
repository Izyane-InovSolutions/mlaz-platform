import type { AppModule } from '../../shared/module.js';
import admin from './presentation/routes.js';

export const financeModule: AppModule = { name: 'finance', routes: { admin } };
