import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '../../shared/db.js';
import { AppError } from '../../shared/errors.js';
import { validationFailed } from '../../shared/validation.js';

/**
 * One error format for the whole API: { error: { code, message, details? } }. Known failures keep their status and
 * code; anything unexpected is logged with its stack and answered with a 500 that carries only the request id.
 */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | AppError | ZodError | Error, req, reply) => {
    const err = error instanceof ZodError ? validationFailed(error) : error;
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'A record with these details already exists.' } });
      if (err.code === 'P2025') return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Record not found.' } });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: { code: (err as FastifyError).code ?? 'BAD_REQUEST', message: err.message } });
    req.log.error({ event: 'http.unhandled_error', err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', requestId: req.id } });
  });

  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } }));
}
