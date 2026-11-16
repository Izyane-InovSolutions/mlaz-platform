// Communications: the transactional outbox (email and SMS), announcements, broadcasts and the resource library.
// Public interface for other modules.
export { type AudienceDirectory, provideAudienceDirectory } from './application/audiences.js';
export { listAnnouncements } from './application/engagement.js';
export { type Message, SIGNOFF, expiresIn, memberPortalUrl } from './application/messages.js';
export { notify, processOutbox } from './application/outbox.js';
