import { api } from '../../../core/api/client.js';

// Member portal. Everything is scoped by the server to the signed-in user's own business (/api/portal).

export const portal = (path, opts) => api(`/portal${path}`, opts);
