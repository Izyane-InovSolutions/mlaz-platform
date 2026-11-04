// Closes the database pool the specs' helpers may have opened in this process. The data is left in mlaz_e2e for
// inspection after a failed run; the next run's global setup resets it.
import { closeDb } from './support/db.ts';

export default async function globalTeardown() {
  await closeDb();
}
