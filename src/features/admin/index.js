// Secretariat console. Every page loads from the API (/api/admin) and every action goes through it; buttons a role
// may not use are hidden, and the server enforces the same permissions regardless.
import { applications } from './applications/index.js';
import { certificates } from './certificates/index.js';
import { communications } from './communications/index.js';
import { dashboard } from './dashboard/index.js';
import { directory } from './directory/index.js';
import { events } from './events/index.js';
import { members } from './members/index.js';
import { payments } from './payments/index.js';
import { reports } from './reports/index.js';
import { settings } from './settings/index.js';
import { adm } from './shared/api.js';
// Registers the viewDoc handler that the application and member pages name in their View buttons. Nothing imports a
// binding from it, so without this import the module is never loaded and those buttons do nothing.
import './shared/documents.js';

export { adminSearch } from './search/index.js';

/* ================= SIDEBAR ================= */
// Badge counts come from a cheap endpoint the router refreshes on every console page.
let NAV = { openApplications: 0, mofToVerify: 0, awaitingApproval: 0, bankTransfers: 0 };
export async function refreshNavCounts() { try { NAV = await adm('/nav-counts'); } catch (e) { /* keep the last counts */ } }

// [id, label, icon, badge, permission needed to see the page]
export const ADMIN_NAV = [
  ['Overview', [['dashboard', 'Dashboard', 'grid-1x2', null, 'dashboard:view'], ['reports', 'Reports', 'file-earmark-bar-graph', null, 'reports:read']]],
  ['Membership', [['members', 'Members', 'people', null, 'members:read'], ['applications', 'Applications', 'file-earmark-text', () => NAV.openApplications, 'applications:read'], ['certificates', 'Certificates', 'award', () => NAV.mofToVerify, 'members:read']]],
  ['Finance', [['payments', 'Payments & dues', 'credit-card', () => NAV.bankTransfers, 'payments:read']]],
  ['Engage', [['communications', 'Communications', 'megaphone'], ['events', 'Events', 'calendar-event', null, 'events:read'], ['directory', 'Public directory', 'globe', null, 'members:read']]],
  ['Configure', [['settings', 'Settings', 'gear']]],
];
export const ADMIN_PAGE_PERM = Object.fromEntries(ADMIN_NAV.flatMap(([, items]) => items.map(i => [i[0], i[4]])));

export const ADMIN_PAGES = { dashboard, reports, members, applications, certificates, payments, communications, events, directory, settings };
