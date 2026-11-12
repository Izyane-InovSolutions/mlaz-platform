import { can } from '../../../core/auth/permissions.js';
import { EL, expose, on } from '../../../core/events.js';
import { asyncModal, done, empty, esc, fail, fmtDate, fmtDateTime, icon, listItem, pageHeader } from '../../../shared/ui/index.js';
import { adm } from '../shared/api.js';

/* ================= COMMUNICATIONS ================= */
let ANNOUNCEMENTS = [];
export async function communications() {
  const [ann, bcs, res] = await Promise.all([adm('/announcements'), adm('/broadcasts'), adm('/resources')]);
  ANNOUNCEMENTS = ann;
  const write = can('comms:write');
  const groups = res.reduce((g, r) => ((g[r.category] ||= []).push(r), g), {});
  return pageHeader('Communications', 'Announcements, email and SMS broadcasts, and the member resource library',
    write ? `<button class="btn btn-outline-secondary" ${on('click', 'newAnnouncement')}>${icon('plus-lg', 'me-1')} Announcement</button><button class="btn btn-primary" ${on('click', 'broadcast')}>${icon('megaphone', 'me-1')} New broadcast</button>` : '')
    + `<div class="row g-3"><div class="col-lg-8">
      <div class="card mb-3"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Announcements</h2><span class="ms-auto small text-body-secondary">Shown on the website and member portal</span></div><div class="list-group list-group-flush">
        ${ann.map(a => listItem('megaphone', 'primary', esc(a.title), `${fmtDate(a.publishedAt)} · ${esc(a.body)}`, `<span class="badge bg-secondary-subtle text-secondary-emphasis">${esc(a.tag)}</span>${write ? `<button class="btn btn-sm btn-light" title="Remove" ${on('click', 'removeAnnouncement', a.id)}>${icon('trash')}</button>` : ''}`)).join('') || empty('No announcements.', 'megaphone')}
      </div></div>
      <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Sent broadcasts</h2></div><div class="list-group list-group-flush">
        ${bcs.map(b => listItem('send', 'info', esc(b.subject), `${fmtDateTime(b.createdAt)} · ${esc(b.audience)} · ${esc(b.channels.join(', '))} · ${Number(b.recipientCount)} recipient${b.recipientCount === 1 ? '' : 's'} · by ${esc(b.createdBy)}`,
          `<span class="small text-nowrap">${Number(b.delivery.sent)} sent${b.delivery.pending ? ` · ${Number(b.delivery.pending)} queued` : ''}${b.delivery.failed ? ` · <span class="text-danger-emphasis">${Number(b.delivery.failed)} failed</span>` : ''}</span>`)).join('') || empty('No broadcasts sent yet.', 'send')}
      </div></div>
    </div><div class="col-lg-4">
      <div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Channels</h2></div><div class="list-group list-group-flush">
        ${listItem('envelope', 'info', 'Email', 'Member contact emails')}${listItem('chat-dots', 'warning', 'SMS', 'Sender ID: MLAZ')}${listItem('window', 'primary', 'Portal & website', 'Announcement feed')}
      </div></div>
      <div class="card"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Resource library</h2>${write ? `<button class="btn btn-sm btn-outline-primary" ${on('click', 'addResource')}>${icon('upload', 'me-1')} Upload</button>` : ''}</div><div class="list-group list-group-flush">
        ${Object.entries(groups).map(([cat, items]) => `<div class="list-group-item bg-body-tertiary small fw-semibold">${icon('folder2', 'me-1')}${esc(cat)} <span class="text-body-secondary fw-normal">(${items.length})</span></div>`
          + items.map(r => `<div class="list-group-item d-flex align-items-center gap-2 small"><div class="flex-grow-1 min-w-0"><div class="fw-medium text-truncate">${esc(r.title)}</div><div class="text-body-secondary">${esc(r.filename)} · ${fmtDate(r.createdAt)}</div></div>
            <button class="btn btn-sm btn-light" title="View" aria-label="View ${esc(r.title)}" ${on('click', 'viewFile', `/admin/resources/${encodeURIComponent(r.id)}/download`, EL, r.title)}>${icon('eye')}</button>${write ? `<button class="btn btn-sm btn-light" title="Remove" ${on('click', 'removeResource', r.id)}>${icon('trash')}</button>` : ''}</div>`).join('')).join('') || empty('No documents in the library yet.', 'folder2')}
      </div></div>
    </div></div>`;
}
function removeAnnouncement(id) {
  const a = ANNOUNCEMENTS.find(x => x.id === id);
  asyncModal({
    title: 'Remove announcement', confirmText: 'Remove', tone: 'danger', body: `<p class="mb-0">Remove “${esc(a?.title)}” from the website and member portal?</p>`,
    onSubmit: async () => { await adm(`/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' }); done('Announcement removed'); },
  });
}
function newAnnouncement() {
  asyncModal({
    title: 'New announcement', confirmText: 'Publish', size: 'lg',
    body: `<div class="row g-3"><div class="col-md-8"><label class="form-label small fw-medium">Title</label><input class="form-control" name="title" required><div class="invalid-feedback">Required.</div></div>
      <div class="col-md-4"><label class="form-label small fw-medium">Tag</label><input class="form-control" name="tag" required value="Notice" list="anntags"><datalist id="anntags"><option>Notice</option><option>Renewals</option><option>Compliance</option><option>Events</option><option>Platform</option></datalist></div>
      <div class="col-12"><label class="form-label small fw-medium">Text</label><textarea class="form-control" name="body" rows="4" required></textarea><div class="invalid-feedback">Required.</div></div></div>`,
    onSubmit: async v => { await adm('/announcements', { method: 'POST', body: v }); done('Announcement published'); },
  });
}
async function broadcast(preset) {
  let auds;
  try { auds = await adm('/broadcasts/audiences'); } catch (e) { return fail(e); }
  const dues = preset === 'DUES_DUE';
  asyncModal({
    title: 'New broadcast', confirmText: `${icon('send', 'me-1')} Send`, size: 'lg', busyText: 'Sending…',
    body: `<div class="row g-3">
      <div class="col-md-6"><label class="form-label small fw-medium">Audience</label><select class="form-select" name="audience">${auds.map(a => `<option value="${esc(a.key)}" ${a.key === (preset || 'ALL') ? 'selected' : ''}>${esc(a.label)} (${Number(a.count)})</option>`).join('')}</select></div>
      <div class="col-md-6"><label class="form-label small fw-medium d-block">Channels</label>
        ${['EMAIL', 'SMS', 'PORTAL'].map(c => `<div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" name="ch_${c}" id="ch_${c}" ${c !== 'PORTAL' || !dues ? 'checked' : ''}><label class="form-check-label small" for="ch_${c}">${{ EMAIL: 'Email', SMS: 'SMS', PORTAL: 'Portal' }[c]}</label></div>`).join('')}</div>
      <div class="col-12"><label class="form-label small fw-medium">Subject</label><input class="form-control" name="subject" required value="${dues ? 'Reminder: membership dues due' : `${new Date().getFullYear() + 1} membership renewals now open`}"><div class="invalid-feedback">Required.</div></div>
      <div class="col-12"><label class="form-label small fw-medium">Message</label><textarea class="form-control" name="body" rows="4" required>${dues ? 'Dear member, our records show your annual dues are due. Pay online in the member portal to keep your accreditation active.' : 'Dear member, renew before your accreditation expires to keep your listing in the public directory. Pay online in the member portal.'}</textarea><div class="invalid-feedback">Required.</div></div>
    </div>`,
    onSubmit: async v => {
      const channels = ['EMAIL', 'SMS', 'PORTAL'].filter(c => v[`ch_${c}`]);
      if (!channels.length) throw new Error('Choose at least one channel.');
      const b = await adm('/broadcasts', { method: 'POST', body: { subject: v.subject, body: v.body, audience: v.audience, channels, tag: dues ? 'Dues' : 'Notice' } });
      done(`Broadcast queued for ${b.recipientCount} member${b.recipientCount === 1 ? '' : 's'}`);
    },
  });
}
function addResource() {
  asyncModal({
    title: 'Upload to the resource library', confirmText: 'Upload', busyText: 'Uploading…',
    body: `<div class="mb-3"><label class="form-label small fw-medium">Title</label><input class="form-control" name="title" required><div class="invalid-feedback">Required.</div></div>
      <div class="mb-3"><label class="form-label small fw-medium">Category</label><input class="form-control" name="category" required list="rescats" value="BoZ & MoF circulars"><datalist id="rescats"><option>BoZ & MoF circulars</option><option>Templates & forms</option><option>MLAZ constitution & code of conduct</option><option>Training materials</option></datalist></div>
      <label class="form-label small fw-medium">File <span class="text-body-secondary fw-normal">(PDF, JPG or PNG, up to 10 MB)</span></label><input class="form-control" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Choose a file.</div>`,
    onSubmit: async (v, form) => { await adm('/resources', { method: 'POST', form: new FormData(form) }); done('Added to the resource library'); },
  });
}
function removeResource(id) {
  asyncModal({
    title: 'Remove resource', confirmText: 'Remove', tone: 'danger', body: '<p class="mb-0">Remove this document from the member resource library?</p>',
    onSubmit: async () => { await adm(`/resources/${encodeURIComponent(id)}`, { method: 'DELETE' }); done('Resource removed'); },
  });
}

expose({ removeAnnouncement, newAnnouncement, broadcast, addResource, removeResource });
