import type { AppModule } from '../../shared/module.js';
import portal from './presentation/routes.js';

export const lendingModule: AppModule = { name: 'lending', routes: { portal } };
