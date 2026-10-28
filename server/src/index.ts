import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/db.js';
import { startJobs } from './jobs/runner.js';

// Longer than the jobs and requests in progress normally need, shorter than a typical orchestrator's kill grace period.
const SHUTDOWN_TIMEOUT_MS = 25_000;

const app = await buildApp();
let stopJobs: () => Promise<void> = async () => {};
let stopping = false;

/**
 * Stops taking requests (Fastify answers 503 to new ones while closing), lets the requests and the background job in
 * progress finish, then closes the database. Runs once; a hard exit backs it up if something hangs.
 */
async function shutdown(reason: string, code = 0) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${reason}: shutting down`);
  setTimeout(() => {
    app.log.error('shutdown timed out; exiting');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  try {
    await stopJobs();
    await app.close();
  } catch (err) {
    app.log.error({ err }, 'error while shutting down');
    code = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
    process.exit(code);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
// A bug that escaped every handler leaves the process in an unknown state: log it, finish what can be finished, exit
// non-zero and let the process manager start a fresh one.
process.on('uncaughtException', err => {
  app.log.fatal({ err }, 'uncaught exception');
  void shutdown('uncaught exception', 1);
});
process.on('unhandledRejection', err => {
  app.log.fatal({ err }, 'unhandled promise rejection');
  void shutdown('unhandled promise rejection', 1);
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.fatal({ err }, 'could not start listening');
  await shutdown('startup failed', 1);
}
// Only once the server is up, so a failed start never leaves a job half-done.
if (config.JOBS_ENABLED) stopJobs = startJobs(app.log);
