import type { FastifyReply, FastifyRequest } from 'fastify';

// HTTP helpers for the presentation layer of every module (and the platform). Nothing below presentation imports this.

export const rateLimit = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });

/** The route's path parameters, typed by name: `params(req, 'ref', 'payRef').payRef`. Fastify has already decoded them. */
export const params = <K extends string>(req: FastifyRequest, ..._names: K[]) => req.params as Record<K, string>;

export const sendPdf = (reply: FastifyReply, filename: string, pdf: Buffer) =>
  reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${filename}"`).header('cache-control', 'private, no-store').send(pdf);

export const sendCsv = (reply: FastifyReply, filename: string, csv: string) =>
  reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${filename}"`).send(csv);

/** A dated file name for exports, e.g. mlaz-members-2026-11-03.csv. */
export const datedName = (stem: string, ext: string) => `${stem}-${new Date().toISOString().slice(0, 10)}.${ext}`;
