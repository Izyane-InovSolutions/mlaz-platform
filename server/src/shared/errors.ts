/** An error with an HTTP status and a stable machine-readable code, rendered by the error handler in app.ts. */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Sign in to continue.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do this.', code = 'FORBIDDEN') => new AppError(403, code, message);
export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string, code = 'CONFLICT', details?: unknown) => new AppError(409, code, message, details);
export const tooMany = (message: string) => new AppError(429, 'TOO_MANY_REQUESTS', message);
