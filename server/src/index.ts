import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/db.js';
import { startJobs } from './jobs/runner.js';

const app = await buildApp();
const stopJobs = config.JOBS_ENABLED ? startJobs(app.log) : () => {};

await app.listen({ host: config.HOST, port: config.PORT });

async function shutdown(signal: string) {
  app.log.info(`${signal} received, shutting down`);
  stopJobs();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
