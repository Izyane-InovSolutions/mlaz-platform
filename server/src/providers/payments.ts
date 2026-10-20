import { randomBytes } from 'node:crypto';
import type { PaymentMethod } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';
import { hmac, safeEqual } from '../lib/tokens.js';

// A payment gateway takes a payment request and later reports the outcome, by webhook or when asked.
// Card payments go to the gateway's hosted checkout (checkoutUrl), so card numbers never reach this server.

export interface InitiateInput {
  ref: string;
  amount: number;
  method: PaymentMethod;
  msisdn?: string | null;
  description: string;
  payerName: string;
}

export interface InitiateResult {
  providerRef: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  checkoutUrl?: string;
  qrPayload?: string;
  failureReason?: string;
}

export interface Outcome {
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  failureReason?: string;
}

export interface WebhookEvent extends Outcome {
  providerRef: string;
}

export interface PaymentProvider {
  name: string;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  /** Asks the gateway for the current status of a payment (used by reconciliation and as a webhook fallback). */
  query(p: { providerRef: string; createdAt: Date; msisdn: string | null }): Promise<Outcome>;
  /** Verifies a webhook's signature and extracts the outcome. Throws on a bad signature. */
  parseWebhook(headers: Record<string, unknown>, rawBody: string): WebhookEvent;
}

/**
 * Simulates the gateway: payments succeed SANDBOX_SETTLE_SECONDS after they are started, except a mobile money number
 * ending in 0000, which is declined. Webhooks are signed with WEBHOOK_SECRET (header x-sandbox-signature, hex HMAC-SHA256).
 */
class SandboxProvider implements PaymentProvider {
  name = 'sandbox';

  async initiate(i: InitiateInput): Promise<InitiateResult> {
    const providerRef = `SBX-${randomBytes(6).toString('hex').toUpperCase()}`;
    return {
      providerRef,
      status: 'PENDING',
      qrPayload: i.method === 'IZYANE_QR' ? `https://pay.izyane.com/sandbox/${providerRef}?amt=${i.amount}` : undefined,
      checkoutUrl: i.method === 'CARD' ? `https://pay.izyane.com/sandbox/checkout/${providerRef}` : undefined,
    };
  }

  async query(p: { providerRef: string; createdAt: Date; msisdn: string | null }): Promise<Outcome> {
    if (Date.now() - p.createdAt.getTime() < config.SANDBOX_SETTLE_SECONDS * 1000) return { status: 'PENDING' };
    if (p.msisdn?.endsWith('0000')) return { status: 'FAILED', failureReason: 'Declined by the payer' };
    return { status: 'SUCCESS' };
  }

  parseWebhook(headers: Record<string, unknown>, rawBody: string): WebhookEvent {
    const sig = headers['x-sandbox-signature'];
    if (typeof sig !== 'string' || !safeEqual(sig, hmac(config.WEBHOOK_SECRET, rawBody))) throw badRequest('Invalid webhook signature.');
    const body = JSON.parse(rawBody) as { providerRef?: string; status?: string; reason?: string };
    if (!body.providerRef || (body.status !== 'SUCCESS' && body.status !== 'FAILED')) throw badRequest('Malformed webhook.');
    return { providerRef: body.providerRef, status: body.status, failureReason: body.reason };
  }
}

const providers: Record<string, PaymentProvider> = { sandbox: new SandboxProvider() };

export const gateway = () => providers[config.PAYMENT_PROVIDER];
export const providerByName = (name: string) => providers[name];
