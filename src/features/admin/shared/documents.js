import { expose } from '../../../core/events.js';
import { showFile } from '../../common/index.js';

/* ================= DOCUMENTS ================= */
// Uploaded identity and licence documents, previewed in the page (features/common/documents.js) with a Download button.
const viewDoc = (id, title) => showFile(`/admin/documents/${encodeURIComponent(id)}`, title);

expose({ viewDoc });
