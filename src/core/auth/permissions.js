import { getSession } from './session-store.js';

// Hides what a role may not use. The server enforces the same permissions regardless.
export const can = permission => !!getSession()?.permissions?.includes(permission);
