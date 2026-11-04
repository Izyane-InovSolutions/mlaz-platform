// Member portal. Everything is scoped by the server to the signed-in user's own business (/api/portal).
import { announcements } from './announcements/index.js';
import { certificates } from './certificates/index.js';
import { customers } from './customers/index.js';
import { dues } from './dues/index.js';
import { events } from './events/index.js';
import { overview } from './overview/index.js';
import { profile } from './profile/index.js';
import { ME } from './shared/state.js';

export { refreshMember } from './shared/state.js';

export const MEMBER_NAV = [
  ['My membership', [['overview', 'Overview', 'grid-1x2'], ['certificates', 'Certificates', 'award'], ['dues', 'Dues & payments', 'credit-card', () => (ME?.dues?.payable ? 1 : 0)]]],
  ['Lending', [['customers', 'Customers', 'people']]],
  ['Engage', [['events', 'Events', 'calendar-event'], ['announcements', 'Announcements', 'megaphone'], ['profile', 'Business profile', 'building']]],
];
export const MEMBER_PAGES = { overview, certificates, dues, customers, events, announcements, profile };
