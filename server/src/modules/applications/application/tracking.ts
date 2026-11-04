import { createHmac } from 'node:crypto';
import { config } from '../../../config.js';
import { safeEqual } from '../../../shared/tokens.js';

/**
 * The token in an applicant's tracking link. Derived from the reference with a server secret, so it can be re-sent in any
 * later email without storing it, and cannot be guessed from the (sequential) reference alone.
 */
export const trackingToken = (ref: string) => createHmac('sha256', config.JWT_SECRET).update(`track:${ref}`).digest('base64url').slice(0, 32);
export const checkTrackingToken = (ref: string, token: unknown) => typeof token === 'string' && safeEqual(trackingToken(ref), token);
export const trackingUrl = (ref: string) => `${config.PUBLIC_APP_URL}/#/track/${ref}?t=${trackingToken(ref)}`;
