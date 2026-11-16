import { download } from '../../core/api/client.js';
import { expose } from '../../core/events.js';
import { busy, fail } from '../../shared/ui/index.js';

/** Downloads a file the API generates (receipt, certificate, CSV export, resource) with the button busy meanwhile. */
export async function getFile(path, btn) {
  busy(btn, true, 'Preparing…');
  try { await download(path); } catch (e) { fail(e); } finally { busy(btn, false); }
}

expose({ getFile });
