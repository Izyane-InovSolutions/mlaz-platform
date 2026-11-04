/** Raised when an external call (gateway, mail server, storage) does not answer in time. */
export class TimeoutError extends Error {
  readonly code = 'TIMEOUT';
}

/**
 * Settles with `work`, or rejects with a TimeoutError after `ms`. The work itself is not cancelled (callers that can
 * cancel pass an AbortSignal of their own), so a caller that cares about a late answer keeps its own reference to it.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
