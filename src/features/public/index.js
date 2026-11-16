// Public website. Every page reads live data from the API (core/api/client.js); nothing here touches browser storage
// except the tracking tokens in core/reference-data.js.
import { secureAccountPage } from '../account/index.js';
import { apply } from './apply/index.js';
import { directory } from './directory/index.js';
import { home } from './home/index.js';
import { setPassword } from './set-password/index.js';
import { login } from './sign-in/index.js';
import { track } from './track/index.js';
import { verify } from './verify/index.js';

export { publicLayout, scrollPendingSection } from './layout/index.js';

export const PUBLIC = { '': home, apply, track, login, verify, directory, 'set-password': setPassword, 'secure-account': secureAccountPage };
