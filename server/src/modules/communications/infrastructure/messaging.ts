import nodemailer from 'nodemailer';
import { config } from '../../../config.js';
import { log } from '../../../shared/log.js';
import { withTimeout } from '../../../shared/timeout.js';
import { redactSecrets } from '../../../shared/tokens.js';

// Delivery drivers for the notification outbox. With no SMTP_URL, emails are logged instead of sent.

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}
export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

/** What the log drivers print. One-time links are redacted: whoever can read the log must not be able to use them. */
export const logLineFor = (kind: string, to: string, text: string) => `[${kind} → ${to}] ${redactSecrets(text).replace(/\s+/g, ' ').slice(0, 300)}`;
// Development only: production refuses to start without SMTP, and with SMS_DRIVER=log (config.ts).
const logLine = (kind: string, to: string, text: string) => log().info({ event: 'message.logged', channel: kind }, logLineFor(kind, to, text));

export interface SmtpLimits {
  /** To connect (DNS included) and to receive the greeting. */
  connectMs: number;
  /** Longest silence from the server on an open connection (a stalled login or DATA phase). */
  socketMs: number;
  /** The whole message, however the time is spent. */
  sendMs: number;
}

/**
 * A failed send, with a message that is safe to store and log: the SMTP error code and the server's reply, never
 * the credentials. The original is kept as `cause` for debugging.
 */
export class DeliveryError extends Error {
  constructor(public code: string, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

// Credentials in a URL (smtp://user:pass@host) must not reach the outbox's lastError or the log.
const scrub = (text: string) => redactSecrets(text).replace(/\/\/[^@\s/]+@/g, '//[redacted]@').slice(0, 300);

export function deliveryError(err: unknown) {
  if (err instanceof DeliveryError) return err;
  const e = err as { code?: string; responseCode?: number; message?: string };
  const code = e.code ?? 'ESEND';
  return new DeliveryError(code, `SMTP ${code}${e.responseCode ? ` ${e.responseCode}` : ''}: ${scrub(e.message ?? String(err))}`, { cause: err });
}

/**
 * Sends through an SMTP server. Every phase is bounded, so a server that accepts the connection and then stalls costs
 * at most `sendMs` per message instead of holding the background jobs; the outbox retries the message later.
 */
export class SmtpMailer implements Mailer {
  private transport;
  constructor(url: string, private limits: SmtpLimits) {
    this.transport = nodemailer.createTransport({
      url, connectionTimeout: limits.connectMs, greetingTimeout: limits.connectMs, dnsTimeout: limits.connectMs, socketTimeout: limits.socketMs,
    });
  }
  async send(to: string, subject: string, text: string) {
    try {
      // A send past the deadline is abandoned here; its connection is closed by socketTimeout at the latest.
      await withTimeout(this.transport.sendMail({ from: config.EMAIL_FROM, to, subject, text }), this.limits.sendMs, 'SMTP send timed out');
    } catch (err) {
      throw deliveryError(err);
    }
  }
  close() { this.transport.close(); }
}

class LogMailer implements Mailer {
  async send(to: string, subject: string, text: string) { logLine('email', to, `${subject} | ${text}`); }
}

// Development stand-in. No SMS gateway has been chosen yet; its adapter goes here, behind SmsSender, selected by
// SMS_DRIVER. Requirements for it are in docs/OPERATIONS.md ("External integrations").
class LogSms implements SmsSender {
  async send(to: string, text: string) { logLine(`sms:${config.SMS_SENDER_ID}`, to, text); }
}

export const mailer: Mailer = config.SMTP_URL
  ? new SmtpMailer(config.SMTP_URL, { connectMs: config.SMTP_CONNECT_TIMEOUT_SECONDS * 1000, socketMs: config.SMTP_SOCKET_TIMEOUT_SECONDS * 1000, sendMs: config.SMTP_SEND_TIMEOUT_SECONDS * 1000 })
  : new LogMailer();
/** The most one email can take before it is given up for this attempt. The outbox plans its batches around it. */
export const MAIL_SEND_LIMIT_MS = config.SMTP_SEND_TIMEOUT_SECONDS * 1000;
/** The SMS driver, or null when SMS is off (SMS_DRIVER=none): then no SMS is queued at all. */
export const sms: SmsSender | null = config.SMS_DRIVER === 'log' ? new LogSms() : null;
