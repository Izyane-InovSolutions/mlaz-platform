import { can } from '../../../core/auth/permissions.js';
import { EL, expose, on } from '../../../core/events.js';
import { K, asyncModal, busy, done, esc, fail, fmtDateTime, icon, listItem, pageHeader, toast } from '../../../shared/ui/index.js';
import { accountCard } from '../../account/index.js';
import { adm } from '../shared/api.js';

/* ================= SETTINGS ================= */
let SETTINGS = null, STAFF_LIST = [];
export async function settings() {
  const manage = can('staff:manage');
  const [st, staff, failedMsgs] = await Promise.all([adm('/settings'), manage ? adm('/staff') : [], manage ? adm('/notifications?status=FAILED') : []]);
  SETTINGS = st; STAFF_LIST = staff;
  const write = can('settings:write');
  const row = (k, v, action = '') => `<div class="d-flex justify-content-between align-items-center gap-2 py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="d-flex align-items-center gap-2"><b>${v}</b>${action}</span></div>`;
  const editBtn = (handler, title) => write ? `<button class="btn btn-sm btn-light" title="${title}" ${on('click', ...handler)}>${icon('pencil')}</button>` : '';
  const b = st.bankAccount, integ = st.integrations;
  // The server decides each integration's state (server/src/shared/integrations.ts); this only labels it.
  const state = i => i.state === 'live' ? '<span class="badge bg-success-subtle text-success-emphasis">Connected</span>'
    : i.state === 'simulated' ? '<span class="badge bg-warning-subtle text-warning-emphasis">Simulated</span>'
      : '<span class="badge bg-secondary-subtle text-secondary-emphasis">Not connected</span>';
  return pageHeader('Settings', 'Your account, tiers, fees, bank account, staff accounts and integrations')
    + `<div class="row g-3">
      <div class="col-lg-6">${accountCard()}</div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Membership tiers & fees</h2>${editBtn(['editFees'], 'Edit fees')}</div><div class="card-body">
        ${st.tiers.map(t => row(`${esc(t.name)}: annual dues${t.active ? '' : ' (inactive)'}`, K(t.annualDues), editBtn(['editTier', t.name], `Edit ${esc(t.name)}`))).join('')}
        ${row('Joining fee', K(st.joiningFee))}${row('Dues payable from', `${Number(st.renewalWindowDays)} days before expiry`)}${row('Renewal cycle', 'Annual, from the accreditation date')}</div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Bank account for transfers</h2>${editBtn(['editBank'], 'Edit bank account')}</div><div class="card-body">
        ${row('Bank', esc(b.bank))}${row('Account name', esc(b.name))}${row('Account number', `<span class="font-monospace">${esc(b.number)}</span>`)}${row('Branch', esc(b.branch))}
        <div class="small text-body-secondary mt-3">Shown to members and applicants who choose to pay by bank transfer.</div></div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Roles</h2></div><div class="list-group list-group-flush">
        ${[['Secretariat Admin', 'Full access · approves recommendations (checker)'], ['Membership Officer', 'Applications, members, MoF renewals · recommends (maker)'], ['Finance Officer', 'Payments, bank transfer review, dues, expenses'], ['Communications Officer', 'Announcements, broadcasts, resources, events'], ['Member', 'Own business profile, dues, certificates, events']].map(([n, d]) => listItem('person', 'secondary', n, d)).join('')}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Integrations</h2></div><div class="list-group list-group-flush">
        ${listItem('phone', 'info', 'Payments (mobile money, QR, card)', `Provider: ${esc(integ.payments.driver)}`, state(integ.payments))}
        ${listItem('envelope', 'info', 'Email', integ.email.state === 'live' ? 'SMTP' : 'Logged to the server console, not delivered', state(integ.email))}
        ${listItem('chat-dots', 'info', 'SMS gateway', integ.sms.state === 'off' ? 'No SMS gateway connected: no SMS is sent' : `Driver: ${esc(integ.sms.driver)}`, state(integ.sms))}
        ${listItem('hdd', 'info', 'Document storage', integ.storage.driver === 's3' ? 'S3 bucket' : 'Server disk', state(integ.storage))}
        ${listItem('search', 'info', 'Credit bureau', integ.creditBureau.state === 'off' ? 'No bureau connected: credit checks are unavailable' : `Driver: ${esc(integ.creditBureau.driver)}`, state(integ.creditBureau))}
        ${listItem('building', 'info', 'ZRA TPIN lookup', 'Format check only', state(integ.tpinLookup))}
      </div></div></div>
      ${manage ? `<div class="col-12"><div class="card"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Staff accounts</h2><button class="btn btn-sm btn-primary" ${on('click', 'inviteStaff')}>${icon('person-plus', 'me-1')} Add staff</button></div>
        <div class="table-responsive"><table class="table align-middle mb-0 small"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Two-factor</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        ${staff.map(u => `<tr class="${u.active ? '' : 'text-body-secondary'}"><td class="fw-medium">${esc(u.name)}${u.title && u.title !== u.roleLabel ? `<div class="text-body-secondary fw-normal">${esc(u.title)}</div>` : ''}</td><td>${esc(u.email)}</td><td>${esc(u.roleLabel)}</td>
          <td>${!u.active ? '<span class="badge bg-secondary-subtle text-secondary-emphasis">Deactivated</span>' : u.invitePending ? '<span class="badge bg-warning-subtle text-warning-emphasis">Invite pending</span>' : '<span class="badge bg-success-subtle text-success-emphasis">Active</span>'}</td>
          <td>${u.mfaEnabled ? `<span class="text-success-emphasis">${icon('shield-check', 'me-1')}On</span>` : '<span class="text-warning-emphasis">Off</span>'}</td>
          <td>${u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—'}</td>
          <td class="text-end text-nowrap">${u.invitePending && u.active ? `<button class="btn btn-sm btn-light" ${on('click', 'resendStaffInvite', u.id, EL)}>Resend invite</button>` : ''}<button class="btn btn-sm btn-light" title="Edit" ${on('click', 'editStaff', u.id)}>${icon('pencil')}</button></td></tr>`).join('')}
        </tbody></table></div></div></div>
      <div class="col-12"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Message delivery problems</h2></div>
        ${failedMsgs.length ? `<div class="table-responsive"><table class="table align-middle mb-0 small"><thead><tr><th>When</th><th>Channel</th><th>To</th><th>Subject</th><th>Error</th><th></th></tr></thead><tbody>
          ${failedMsgs.map(n => `<tr><td>${fmtDateTime(n.createdAt)}</td><td>${esc(n.channel)}</td><td>${esc(n.to)}</td><td>${esc(n.subject || '—')}</td><td class="text-danger-emphasis">${esc(n.lastError || '')}</td>
            <td class="text-end"><button class="btn btn-sm btn-light" ${on('click', 'retryMessage', n.id, EL)}>Retry</button></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="card-body small text-body-secondary">${icon('check2-circle', 'me-1 text-success')}All emails and SMS were delivered.</div>`}</div></div>` : ''}
    </div>`;
}
function editTier(name) {
  const t = SETTINGS.tiers.find(x => x.name === name);
  asyncModal({
    title: `${esc(name)} tier`, confirmText: 'Save',
    body: `<div class="mb-3"><label class="form-label small fw-medium">Annual dues (K)</label><input class="form-control" type="number" name="annualDues" min="0" step="1" value="${Number(t.annualDues)}" required></div>
      <label class="form-label small fw-medium">Description</label><textarea class="form-control" name="description" rows="2">${esc(t.description)}</textarea>
      <div class="form-text">New dues apply to payments started from now on.</div>`,
    onSubmit: async v => { await adm(`/settings/tiers/${encodeURIComponent(name)}`, { method: 'PUT', body: { annualDues: Number(v.annualDues), description: v.description } }); done(`${name} tier saved`); },
  });
}
function editFees() {
  asyncModal({
    title: 'Fees', confirmText: 'Save',
    body: `<div class="mb-3"><label class="form-label small fw-medium">Joining fee (K)</label><input class="form-control" type="number" name="joiningFee" min="0" step="1" value="${Number(SETTINGS.joiningFee)}" required></div>
      <label class="form-label small fw-medium">Dues payable this many days before expiry</label><input class="form-control" type="number" name="renewalWindowDays" min="0" max="365" value="${Number(SETTINGS.renewalWindowDays)}" required>`,
    onSubmit: async v => { await adm('/settings/fees', { method: 'PUT', body: { joiningFee: Number(v.joiningFee), renewalWindowDays: Number(v.renewalWindowDays) } }); done('Fees saved'); },
  });
}
function editBank() {
  const b = SETTINGS.bankAccount;
  const f = (n, l) => `<div class="mb-3"><label class="form-label small fw-medium">${l}</label><input class="form-control" name="${n}" value="${esc(b[n])}" required><div class="invalid-feedback">Required.</div></div>`;
  asyncModal({
    title: 'Bank account', confirmText: 'Save', body: f('bank', 'Bank') + f('name', 'Account name') + f('number', 'Account number') + f('branch', 'Branch'),
    onSubmit: async v => { await adm('/settings/bank-account', { method: 'PUT', body: v }); done('Bank account saved'); },
  });
}
const roleOptions = sel => SETTINGS.roles.map(r => `<option value="${esc(r.role)}" ${r.role === sel ? 'selected' : ''}>${esc(r.label)}</option>`).join('');
function inviteStaff() {
  asyncModal({
    title: 'Add staff member', confirmText: 'Send invitation',
    body: `<div class="mb-3"><label class="form-label small fw-medium">Full name</label><input class="form-control" name="name" required><div class="invalid-feedback">Required.</div></div>
      <div class="mb-3"><label class="form-label small fw-medium">Email</label><input class="form-control" type="email" name="email" required placeholder="name@mlaz.org.zm"><div class="invalid-feedback">Enter a valid email.</div></div>
      <div class="mb-3"><label class="form-label small fw-medium">Role</label><select class="form-select" name="role">${roleOptions('MEMBERSHIP_OFFICER')}</select></div>
      <label class="form-label small fw-medium">Job title <span class="text-body-secondary fw-normal">(optional)</span></label><input class="form-control" name="title">`,
    onSubmit: async v => { await adm('/staff', { method: 'POST', body: { ...v, title: v.title || undefined } }); done(`Invitation sent to ${v.email}`); },
  });
}
function editStaff(id) {
  const u = STAFF_LIST.find(x => x.id === id); if (!u) return;
  asyncModal({
    title: `Edit ${esc(u.name)}`, confirmText: 'Save',
    body: `<div class="mb-3"><label class="form-label small fw-medium">Role</label><select class="form-select" name="role">${roleOptions(u.role)}</select></div>
      <div class="mb-3"><label class="form-label small fw-medium">Job title</label><input class="form-control" name="title" value="${esc(u.title || '')}"></div>
      <div class="form-check"><input class="form-check-input" type="checkbox" name="active" id="staffactive" ${u.active ? 'checked' : ''}><label class="form-check-label small" for="staffactive">Account active (unticking signs them out everywhere)</label></div>
      ${u.mfaEnabled ? '<div class="form-check mt-2"><input class="form-check-input" type="checkbox" name="resetMfa" id="staffmfa"><label class="form-check-label small" for="staffmfa">Reset two-factor sign-in (lost phone): they sign in with their password and enrol again</label></div>' : ''}`,
    onSubmit: async v => {
      await adm(`/staff/${encodeURIComponent(id)}`, { method: 'PATCH', body: { role: v.role, title: v.title || null, active: v.active, ...(v.resetMfa && { resetMfa: true }) } });
      done('Staff account saved');
    },
  });
}
async function retryMessage(id, btn) {
  busy(btn, true, 'Queuing…');
  try { await adm(`/notifications/${encodeURIComponent(id)}/retry`, { method: 'POST' }); done('Message queued again'); } catch (e) { busy(btn, false); fail(e); }
}
async function resendStaffInvite(id, btn) {
  busy(btn, true, 'Sending…');
  try { await adm(`/staff/${encodeURIComponent(id)}/resend-invite`, { method: 'POST' }); toast('Invitation sent again'); } catch (e) { fail(e); } finally { busy(btn, false); }
}

expose({ editTier, editFees, editBank, inviteStaff, editStaff, resendStaffInvite, retryMessage });
