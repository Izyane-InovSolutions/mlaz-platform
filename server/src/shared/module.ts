import type { FastifyPluginAsync } from 'fastify';

/**
 * Where a module's routes are mounted. The platform owns each scope's prefix and guard:
 *   auth /api/auth (no session) · public /api/public (no session) · portal /api/portal (member session)
 *   admin /api/admin (staff session) · webhooks /api/webhooks (signed by the caller, raw body)
 */
export type RouteScope = 'auth' | 'public' | 'portal' | 'admin' | 'webhooks';

/** What a module hands the platform (its module.ts). Its public functions for other modules are in its index.ts. */
export interface AppModule {
  name: string;
  routes?: Partial<Record<RouteScope, FastifyPluginAsync>>;
}
