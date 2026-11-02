// External service timeouts (D8): a mail server or storage service that stalls costs a bounded time, fails with a
// controlled error that carries no credentials, and is retried only when retrying can help. Real sockets on
// localhost play the misbehaving servers.
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type Socket } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { prisma } from '../src/lib/db.js';
import { AppError } from '../src/lib/errors.js';
import { S3Storage, isRetryable } from '../src/lib/storage.js';
import { DeliveryError, SmtpMailer, mailer, sms } from '../src/providers/messaging.js';
import { processOutbox } from '../src/services/notifications.js';
import { resetDb } from './helpers.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  vi.restoreAllMocks();
});

/* ================= SMTP ================= */

/** A fake SMTP server. `reply` answers a command line (null: stay silent; undefined: the default answer); `greet` false never greets. */
async function smtpServer(o: { greet?: boolean; delayMs?: number; reply?: (line: string) => string | null | undefined }) {
  const sockets = new Set<Socket>();
  const server = createTcpServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    const say = (text: string) => setTimeout(() => socket.writable && socket.write(`${text}\r\n`), o.delayMs ?? 0);
    if (o.greet !== false) say('220 localhost ESMTP test');
    let buffer = '', inData = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; say('250 queued'); }
          continue;
        }
        const custom = o.reply?.(line);
        if (custom === null) continue;
        if (custom !== undefined) { say(custom); continue; }
        if (/^(EHLO|HELO)/i.test(line)) say('250-localhost\r\n250 AUTH PLAIN LOGIN');
        else if (/^DATA/i.test(line)) { inData = true; say('354 go ahead'); }
        else if (/^QUIT/i.test(line)) { say('221 bye'); socket.end(); }
        else say('250 ok');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise(resolve => {
    for (const s of sockets) s.destroy();
    server.close(() => resolve());
  }));
  return (server.address() as AddressInfo).port;
}

const limits = { connectMs: 300, socketMs: 300, sendMs: 5_000 };
function mailerFor(url: string, l = limits) {
  const m = new SmtpMailer(url, l);
  cleanups.push(() => m.close());
  return m;
}

/** Sends, and returns the error and how long it took to arrive. */
async function failedSend(m: SmtpMailer) {
  const started = Date.now();
  const err = await m.send('member@example.zm', 'Subject', 'Body').then(() => null, (e: unknown) => e);
  return { err: err as DeliveryError, ms: Date.now() - started };
}

describe('SMTP timeouts', () => {
  it('delivers through a server that answers', async () => {
    const port = await smtpServer({});
    await expect(mailerFor(`smtp://127.0.0.1:${port}`).send('member@example.zm', 'Hello', 'Body')).resolves.toBeUndefined();
  });

  it('gives up on a server that accepts the connection but never greets', async () => {
    const port = await smtpServer({ greet: false });
    const { err, ms } = await failedSend(mailerFor(`smtp://127.0.0.1:${port}`));
    expect(err).toBeInstanceOf(DeliveryError);
    expect(ms).toBeLessThan(3_000); // nodemailer's own default would wait 30 s for the greeting, 10 min on a silent socket
  });

  it('gives up on a server that stalls part-way through a message', async () => {
    const port = await smtpServer({ reply: line => (/^MAIL FROM/i.test(line) ? null : undefined) });
    const { err, ms } = await failedSend(mailerFor(`smtp://127.0.0.1:${port}`));
    expect(err).toBeInstanceOf(DeliveryError);
    expect(ms).toBeLessThan(3_000);
  });

  it('caps the whole message even when the server keeps answering, slowly', async () => {
    const port = await smtpServer({ delayMs: 150 }); // each answer inside the socket timeout; the total is not
    const { err, ms } = await failedSend(mailerFor(`smtp://127.0.0.1:${port}`, { connectMs: 2_000, socketMs: 2_000, sendMs: 400 }));
    expect(err).toBeInstanceOf(DeliveryError);
    expect(err.code).toBe('TIMEOUT');
    expect(ms).toBeLessThan(2_000);
  });

  it('reports a rejected login without the password, from the server or the URL', async () => {
    const port = await smtpServer({ reply: line => (/^AUTH/i.test(line) ? '535 5.7.8 Authentication failed' : undefined) });
    const { err } = await failedSend(mailerFor(`smtp://mailer:Sup3r-Secret-Pw@127.0.0.1:${port}`));
    expect(err).toBeInstanceOf(DeliveryError);
    expect(err.code).toBe('EAUTH');
    expect(err.message).toMatch(/^SMTP EAUTH 535/);
    expect(err.message).not.toContain('Sup3r-Secret-Pw');
    expect(err.message).not.toContain('mailer:');
  });
});

describe('notification outbox with a slow or failing mail server', () => {
  beforeAll(resetDb);

  const queue = (n: number, channel: 'EMAIL' | 'SMS') =>
    prisma.notification.createMany({ data: Array.from({ length: n }, (_, i) => ({ channel, to: `${channel}-${i}@example.zm`, subject: 's', body: `message ${i}` })) });

  it('never starts a send that might outlast its claim on the message; the rest go back to the queue unharmed', async () => {
    await prisma.notification.deleteMany();
    await queue(3, 'SMS');
    // One send outlasts the whole budget, so only the first may start, however fast or slow this machine is.
    vi.spyOn(sms, 'send').mockImplementation(() => new Promise(r => setTimeout(r, 1_500)));
    expect(await processOutbox(25, 1_000)).toBe(1);
    const rows = await prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.filter(n => n.status === 'SENT')).toHaveLength(1);
    const handedBack = rows.filter(n => n.status === 'PENDING');
    expect(handedBack).toHaveLength(2);
    for (const n of handedBack) {
      expect(n.attempts).toBe(0); // not counted against its retries
      expect(n.sendAfter.getTime()).toBeLessThanOrEqual(Date.now()); // due again at once
    }
  });

  it('keeps the outbox budget inside the claim for any allowed SMTP_SEND_TIMEOUT_SECONDS', () => {
    // processOutbox's budget is the 5-minute claim, less one full send and a 30 s margin: it must stay positive.
    expect(5 * 60 - 240 - 30).toBeGreaterThan(0);
    expect(config.SMTP_SEND_TIMEOUT_SECONDS).toBeLessThanOrEqual(240);
  });

  it('backs off after a failed send, and logs the failure without the recipient or the message', async () => {
    await prisma.notification.deleteMany();
    await queue(1, 'EMAIL');
    vi.spyOn(mailer, 'send').mockRejectedValue(new DeliveryError('TIMEOUT', 'SMTP TIMEOUT: SMTP send timed out'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await processOutbox()).toBe(0);
    const n = await prisma.notification.findFirstOrThrow();
    expect(n).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'SMTP TIMEOUT: SMTP send timed out' });
    expect(n.sendAfter.getTime()).toBeGreaterThan(Date.now() + 60e3); // retried later, per the existing policy
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain(n.id);
    expect(line).not.toContain('EMAIL-0@example.zm');
    expect(line).not.toContain('message 0');

    // The fifth failed attempt gives up, as before.
    await prisma.notification.update({ where: { id: n.id }, data: { attempts: 4, sendAfter: new Date() } });
    await processOutbox();
    expect(await prisma.notification.findFirstOrThrow()).toMatchObject({ status: 'FAILED', attempts: 5 });
  });
});

/* ================= S3 ================= */

type Handler = (req: IncomingMessage, res: ServerResponse, body: Buffer, n: number) => void;

/** A fake S3 endpoint. Records every request (method, path and body) and lets `handle` answer, or not answer, each. */
async function s3Server(handle: Handler) {
  const requests: { method: string; url: string; body: Buffer }[] = [];
  const server = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method!, url: req.url!, body });
      handle(req, res, body, requests.length);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  const storage = (l: Partial<ConstructorParameters<typeof S3Storage>[0]['limits']> = {}) => new S3Storage({
    bucket: 'docs', region: 'us-east-1', endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    credentials: { accessKeyId: 'AKIAFAKEKEY0001', secretAccessKey: 'fake-secret-value' },
    limits: { connectMs: 1_000, socketMs: 250, operationMs: 10_000, maxAttempts: 3, backoffBaseMs: 10, backoffCapMs: 50, ...l },
  });
  return { requests, storage };
}

const s3Error = (res: ServerResponse, status: number, code: string) => {
  res.writeHead(status, { 'content-type': 'application/xml' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
};
const ok = (res: ServerResponse, body = '') => {
  res.writeHead(200, { etag: '"abc"', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

/** Runs `op` and returns the error it failed with, and how long that took. */
async function failure(op: () => Promise<unknown>) {
  const started = Date.now();
  const err = await op().then(() => null, (e: unknown) => e);
  return { err: err as AppError, ms: Date.now() - started };
}

describe('S3 timeouts and retries', () => {
  it('retries a stalled request a bounded number of times, then fails with a 503', async () => {
    const { requests, storage } = await s3Server(() => {}); // never answers
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { err, ms } = await failure(() => storage().stream('documents/a.pdf'));
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 503, code: 'STORAGE_UNAVAILABLE' });
    expect(requests).toHaveLength(3);
    expect(ms).toBeLessThan(5_000);
  });

  it('bounds the whole operation, retries included', async () => {
    const { requests, storage } = await s3Server(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { err, ms } = await failure(() => storage({ socketMs: 5_000, operationMs: 300 }).remove('documents/a.pdf'));
    expect(err).toMatchObject({ status: 503, code: 'STORAGE_UNAVAILABLE' });
    expect(requests).toHaveLength(1);
    expect(ms).toBeLessThan(2_000);
  });

  it('retries a server error and succeeds', async () => {
    const { requests, storage } = await s3Server((_req, res, _body, n) => (n === 1 ? s3Error(res, 503, 'SlowDown') : ok(res)));
    await storage().remove('documents/a.pdf');
    expect(requests).toHaveLength(2);
  });

  it('sends an upload again from a fresh stream when the first attempt fails', async () => {
    const { requests, storage } = await s3Server((_req, res, _body, n) => (n === 1 ? s3Error(res, 500, 'InternalError') : ok(res)));
    const dir = path.resolve(config.UPLOAD_TMP_DIR);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 's3-retry-test.upload');
    const content = Buffer.from('%PDF-1.4 retried upload body');
    await writeFile(file, content);
    await storage().putFile('documents/b.pdf', file, 'application/pdf', content.length);
    expect(requests.map(r => r.method)).toEqual(['PUT', 'PUT']);
    for (const r of requests) expect(r.body.includes(content)).toBe(true); // the second attempt carried the whole file
  });

  it('does not retry a missing object (404) or a refusal (403)', async () => {
    const missing = await s3Server((_req, res) => s3Error(res, 404, 'NoSuchKey'));
    const { err: notFound } = await failure(() => missing.storage().stream('documents/gone.pdf'));
    expect(notFound).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(missing.requests).toHaveLength(1);

    const denied = await s3Server((_req, res) => s3Error(res, 403, 'AccessDenied'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { err } = await failure(() => denied.storage().remove('documents/a.pdf'));
    expect(err).toMatchObject({ status: 503, code: 'STORAGE_UNAVAILABLE' });
    expect(denied.requests).toHaveLength(1);
    expect(String(log.mock.calls[0][0])).not.toMatch(/AKIAFAKEKEY0001|fake-secret-value/); // no credentials in the log line
  });

  it('streams a download whose body takes longer than the operation cap, as long as it keeps flowing', async () => {
    const { storage } = await s3Server((_req, res) => {
      res.writeHead(200, { 'content-length': 6 });
      res.write('abc');
      setTimeout(() => res.end('def'), 200);
    });
    const body = await storage({ operationMs: 100, socketMs: 1_000 }).stream('documents/slow.pdf');
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('abcdef');
  });

  it('classifies errors: timeouts, throttling and 5xx are retryable; 4xx, aborts and unknown errors are not', () => {
    expect(isRetryable(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryable({ name: 'SlowDown', $metadata: { httpStatusCode: 503 } })).toBe(true);
    expect(isRetryable({ name: 'Throttled', $metadata: { httpStatusCode: 429 } })).toBe(true);
    expect(isRetryable({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })).toBe(false);
    expect(isRetryable({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } })).toBe(false);
    expect(isRetryable(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false);
    expect(isRetryable(new TypeError('bug'))).toBe(false);
  });
});
