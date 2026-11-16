import { config } from '../config.js';

// What each external integration really is in this deployment. The Settings screen and the monitoring endpoint show
// these states; nothing else decides whether an integration counts as connected.
//   live       talks to the real provider
//   simulated  a stand-in that invents results or only logs (development, or a staging site)
//   off        not connected: the feature is unavailable and says so
// When a real adapter is added for one of these, its driver name maps to `live` here.


export type IntegrationState = 'live' | 'simulated' | 'off';
export interface Integration { driver: string; state: IntegrationState }

export function integrations(): Record<'payments' | 'email' | 'sms' | 'storage' | 'creditBureau' | 'tpinLookup', Integration> {
  return {
    payments: { driver: config.PAYMENT_PROVIDER, state: config.PAYMENT_PROVIDER === 'sandbox' ? 'simulated' : 'live' },
    email: config.SMTP_URL ? { driver: 'smtp', state: 'live' } : { driver: 'log', state: 'simulated' },
    sms: { driver: config.SMS_DRIVER, state: config.SMS_DRIVER === 'log' ? 'simulated' : 'off' },
    storage: { driver: config.STORAGE_DRIVER, state: 'live' },
    creditBureau: { driver: config.BUREAU_DRIVER, state: config.BUREAU_DRIVER === 'simulated' ? 'simulated' : 'off' },
    // No ZRA TPIN lookup exists: applications get a format check only (applications/domain/journey.ts).
    tpinLookup: { driver: 'none', state: 'off' },
  };
}
