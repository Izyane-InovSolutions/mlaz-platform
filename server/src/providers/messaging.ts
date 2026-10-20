import nodemailer from 'nodemailer';
import { config } from '../config.js';

// Delivery drivers for the notification outbox. With no SMTP_URL, emails are logged instead of sent.

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}
export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

const logLine = (kind: string, to: string, text: string) => {
  if (config.NODE_ENV !== 'test') console.log(`[${kind} → ${to}] ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
};

class SmtpMailer implements Mailer {
  private transport = nodemailer.createTransport(config.SMTP_URL);
  async send(to: string, subject: string, text: string) {
    await this.transport.sendMail({ from: config.EMAIL_FROM, to, subject, text });
  }
}

class LogMailer implements Mailer {
  async send(to: string, subject: string, text: string) { logLine('email', to, `${subject} | ${text}`); }
}

// Replace with the SMS gateway MLAZ contracts (e.g. an HTTP API taking sender ID, number and text).
class LogSms implements SmsSender {
  async send(to: string, text: string) { logLine(`sms:${config.SMS_SENDER_ID}`, to, text); }
}

export const mailer: Mailer = config.SMTP_URL ? new SmtpMailer() : new LogMailer();
export const sms: SmsSender = new LogSms();
