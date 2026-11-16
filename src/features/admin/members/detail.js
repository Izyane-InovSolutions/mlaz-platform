import { can } from '../../../core/auth/permissions.js';
import { publicConfig } from '../../../core/reference-data.js';
import { EL, expose, on } from '../../../core/events.js';
import { K, asyncModal, avatar, busy, done, empty, esc, fail, fmtDate, fmtDateTime, icon, infoRow as info, listItem, lower, note, pageHeader, statCard } from '../../../shared/ui/index.js';
import { ACTIVITY, accredBadge, mofBadge, statusBadge, tierBadge } from '../../common/index.js';
import { adm } from '../shared/api.js';
import { DOC_KIND, auditCard, crumb, offlineFields, paymentRow, tomorrow } from '../shared/ui.js';

let CUR_MEMBER = null;

export async function memberDetail(number) {
  const m = CUR_MEMBER = await adm(`/members/${encodeURIComponent(number)}`);
  const n = esc(m.number), num = m.number, d = m.dues;
  const renewal = m.pendingRenewal && m.renewals.find(r => r.id === m.pendingRenewal.id);
  const actions = [
    m.certificate ? `<button class="btn btn-outline-secondary" ${on('click', 'viewFile', `/admin/members/${encodeURIComponent(num)}/certificate.pdf`, EL, 'Accreditation certificate')}>${icon('award', 'me-1')} Certificate</button>` : '',
    can('members:write') ? `<button class="btn btn-outline-secondary" ${on('click', 'editMember')}>${icon('pencil', 'me-1')} Edit</button><button class="btn btn-outline-secondary" ${on('click', 'sendReminder', num, EL)}>${icon('envelope', 'me-1')} Send reminder</button>` : '',
    can('payments:record') && d.payable ? `<button class="btn btn-outline-secondary" ${on('click', 'recordDues', num)}>${icon('cash', 'me-1')} Record dues payment</button>` : '',
    can('members:write') ? (m.status === 'ACTIVE' ? `<button class="btn btn-outline-danger" ${on('click', 'suspendMember', num)}>${icon('slash-circle', 'me-1')} Suspend</button>` : `<button class="btn btn-primary" ${on('click', 'reinstateMember', num)}>${icon('arrow-counterclockwise', 'me-1')} Reinstate</button>`) : '',
  ].join('');
  const duesBadgeHtml = d.overdue ? '<span class="badge rounded-pill bg-danger-subtle text-danger-emphasis border border-danger-subtle">Overdue</span>'
    : d.payable ? '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis border border-warning-subtle">Due</span>'
      : '<span class="badge rounded-pill bg-success-subtle text-success-emphasis border border-success-subtle">Paid</span>';
  return pageHeader(esc(m.name), `${n} · ${esc(m.town)}, ${esc(m.province)} · member since ${fmtDate(m.joinedAt)}`, actions, crumb('members', 'Members', m.name))
    + (m.status === 'SUSPENDED' ? note('danger', 'slash-circle', `<b>Suspended${m.suspension === 'MOF_EXPIRED' ? ' (MoF authorization expired)' : ' by the Secretariat'}.</b> ${esc(m.suspensionReason || '')}${m.suspension === 'MOF_EXPIRED' ? ' The suspension is lifted automatically when a renewed authorization is verified.' : ''}`) : '')
    + (m.status === 'LAPSED' ? note('warning', 'hourglass-bottom', `<b>Lapsed.</b> The paid period ended ${fmtDate(m.validUntil)}. Recording a dues payment restores the membership.`) : '')
    + `<div class="row g-3">
      <div class="col-lg-4"><div class="card"><div class="card-body p-4">
        <div class="text-center mb-3">${avatar(m.name, 0, true)}<h2 class="h5 mt-3 mb-1">${esc(m.name)}</h2><div class="d-flex justify-content-center gap-1">${tierBadge(m.tier)} ${statusBadge(lower(m.status))}</div></div>
        ${info('Contact', esc(m.contactName))}${info('Phone', esc(m.contactPhone))}${info('Email', esc(m.contactEmail))}${info('ZRA TPIN', esc(m.tpin))}${info('PACRA no.', esc(m.pacra || '—'))}${info('Address', esc(m.address || '—'))}${info('Joined', fmtDate(m.joinedAt))}
        ${info('Public listing', m.goodStanding ? '<span class="text-success-emphasis">Listed, passes verification</span>' : '<span class="text-danger-emphasis">Hidden, fails verification</span>')}
      </div></div>
      <div class="card mt-3"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Portal users</h2>${can('members:write') ? `<button class="btn btn-sm btn-outline-primary" ${on('click', 'inviteUser', num)}>${icon('person-plus', 'me-1')} Invite</button>` : ''}</div>
        <div class="list-group list-group-flush">${m.users.map(u => listItem('person', u.active ? 'primary' : 'secondary', `${esc(u.name)}${u.active ? '' : ' <span class="badge bg-secondary-subtle text-secondary-emphasis">Deactivated</span>'}`,
          `${esc(u.email)}${u.invitePending ? ' · invitation not yet accepted' : u.lastLoginAt ? ` · last signed in ${fmtDateTime(u.lastLoginAt)}` : ''}`,
          can('members:write') ? `<button class="btn btn-sm ${u.active ? 'btn-outline-danger' : 'btn-outline-secondary'}" ${on('click', 'setPortalUser', m.number, u.id, !u.active)}>${u.active ? 'Deactivate' : 'Reactivate'}</button>` : '')).join('') || empty('No portal users yet.', 'person')}</div></div>
      </div>
      <div class="col-lg-8">
        <div class="row g-3 mb-3">
          <div class="col-md-4">${statCard('MoF authorization', mofBadge(lower(m.mofStatus)), `${esc(m.mofRef)}${m.mofExpiry ? ` · expires ${fmtDate(m.mofExpiry)}` : ''}`, 'file-earmark-check', 'info')}</div>
          <div class="col-md-4">${statCard('Accreditation', accredBadge(lower(m.accreditation)), `Valid until ${fmtDate(m.validUntil)}`, 'award', 'success')}</div>
          <div class="col-md-4">${statCard('Annual dues', duesBadgeHtml, `${esc(m.tier)} · ${K(d.amount)}${d.payable ? '' : ` · next payable from ${fmtDate(d.opensOn)}`}`, 'cash-stack', 'warning')}</div>
        </div>
        ${renewal ? `<div class="card mb-3 border-warning-subtle"><div class="card-header bg-warning-subtle"><h2 class="h6 mb-0 py-1">${icon('file-earmark-arrow-up', 'me-1')}MoF renewal awaiting verification</h2></div><div class="card-body">
          <p class="small mb-3">Renewed authorization <b>${esc(renewal.mofRef)}</b> uploaded ${fmtDateTime(renewal.submittedAt)}. Check it against the Ministry of Finance register, then record its expiry date.</p>
          <div class="d-flex flex-wrap gap-2">${renewal.document && can('documents:read') ? `<button class="btn btn-outline-secondary" ${on('click', 'viewDoc', renewal.document.id, `MoF renewal · ${m.name}`)}>${icon('eye', 'me-1')} View document</button>` : ''}
          ${can('renewals:verify') ? `<button class="btn btn-outline-danger" ${on('click', 'rejectRenewal', renewal.id)}>Reject</button><button class="btn btn-primary" ${on('click', 'verifyRenewal', renewal.id, renewal.mofRef)}>${icon('check-lg', 'me-1')} Verify renewal</button>` : ''}</div></div></div>` : ''}
        <div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Documents</h2></div><div class="list-group list-group-flush">
          ${m.documents.map(doc => listItem(doc.kind === 'DIRECTOR_NRC' ? 'person-vcard' : doc.kind === 'PROOF_OF_PAYMENT' ? 'receipt' : 'file-earmark-text', doc.superseded ? 'secondary' : 'info', `${DOC_KIND[doc.kind] || esc(doc.kind)}${doc.superseded ? ' <span class="badge bg-secondary-subtle text-secondary-emphasis">Replaced</span>' : ''}`, `${esc(doc.filename)} · ${fmtDate(doc.createdAt)}`,
            can('documents:read') ? `<button class="btn btn-sm btn-outline-primary text-nowrap" ${on('click', 'viewDoc', doc.id, `${DOC_KIND[doc.kind] || doc.kind} · ${m.name}`)}>${icon('eye', 'me-1')} View</button>` : '')).join('') || empty('No documents on file.', 'folder')}
        </div></div>
        <div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Payments</h2></div>
          ${m.payments.length ? `<div class="table-responsive"><table class="table table-sm align-middle mb-0 small"><thead><tr><th>Reference</th><th>Date</th><th>Description</th><th>Method</th><th class="text-end">Amount</th><th>Status</th><th></th></tr></thead><tbody>${m.payments.map(p => paymentRow(p, { payer: false })).join('')}</tbody></table></div>` : `<div class="card-body">${empty('No payments yet.', 'credit-card')}</div>`}</div>
        <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Activity</h2></div><div class="list-group list-group-flush">
          ${m.activity.map(a => { const [ic, tone] = ACTIVITY[a.kind] || ['dot', 'secondary']; return listItem(ic, tone, esc(a.title), `${esc(a.detail)}${a.detail ? ' · ' : ''}${fmtDateTime(a.at)}`); }).join('') || empty('No activity yet.', 'activity')}
        </div></div>
        ${auditCard(m.audit)}
      </div>
    </div>`;
}

function editMember() {
  const m = CUR_MEMBER;
  const f = (name, label, value, attrs = '', col = 'col-md-6') => `<div class="${col}"><label class="form-label small fw-medium">${label}</label><input class="form-control" name="${name}" value="${esc(value)}" ${attrs}><div class="invalid-feedback">Check this field.</div></div>`;
  publicConfig().then(cfg => asyncModal({
    title: `Edit ${esc(m.name)}`, size: 'lg', confirmText: 'Save changes',
    body: `<div class="row g-3">${f('name', 'Business name', m.name, 'required', 'col-12')}${f('town', 'Town', m.town, 'required')}
      <div class="col-md-6"><label class="form-label small fw-medium">Province</label><select class="form-select" name="province">${cfg.provinces.map(p => `<option ${p === m.province ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
      ${f('address', 'Address', m.address, '', 'col-12')}${f('tpin', 'ZRA TPIN', m.tpin, 'required pattern="[0-9]{10}" maxlength="10"')}${f('pacra', 'PACRA no.', m.pacra, 'pattern="[0-9]{12}" maxlength="12"')}
      <div class="col-md-6"><label class="form-label small fw-medium">Tier</label><select class="form-select" name="tier">${cfg.tiers.map(t => `<option ${t.name === m.tier ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      ${f('contactName', 'Contact person', m.contactName, 'required')}${f('contactPhone', 'Phone', m.contactPhone, 'required type="tel"')}${f('contactEmail', 'Email', m.contactEmail, 'required type="email"')}</div>`,
    onSubmit: async v => { await adm(`/members/${encodeURIComponent(m.number)}`, { method: 'PATCH', body: v }); done('Member details saved'); },
  })).catch(fail);
}
async function sendReminder(n, btn) {
  busy(btn, true, 'Sending…');
  try { await adm(`/members/${encodeURIComponent(n)}/reminders`, { method: 'POST' }); done('Reminder sent by email and SMS'); } catch (e) { busy(btn, false); fail(e); }
}
function recordDues(n) {
  const d = CUR_MEMBER.dues;
  asyncModal({
    title: 'Record dues payment', confirmText: 'Record payment',
    body: `<p class="small text-body-secondary">Record ${K(d.amount)} received from ${esc(CUR_MEMBER.name)} outside the online checkout, for ${fmtDate(d.periodStart)} to ${fmtDate(d.periodEnd)}. Only record money you can see on the MLAZ bank statement or a cash receipt.</p>${offlineFields()}`,
    onSubmit: async v => { await adm(`/members/${encodeURIComponent(n)}/offline-dues`, { method: 'POST', body: v }); done('Payment recorded. Membership extended and receipt sent'); },
  });
}
function suspendMember(n) {
  asyncModal({
    title: 'Suspend member', confirmText: 'Suspend', tone: 'danger',
    body: `<p>Suspending <b>${esc(CUR_MEMBER.name)}</b> revokes their accreditation and removes them from the public directory. Only staff can reinstate them.</p><label class="form-label small fw-medium">Reason (sent to the member)</label><textarea class="form-control" name="reason" rows="2" required>Non-compliance with the MLAZ code of conduct</textarea><div class="invalid-feedback">Give a reason.</div>`,
    onSubmit: async v => { await adm(`/members/${encodeURIComponent(n)}/suspend`, { method: 'POST', body: { reason: v.reason } }); done(`${CUR_MEMBER.name} suspended`); },
  });
}
function reinstateMember(n) {
  asyncModal({
    title: 'Reinstate member', confirmText: 'Reinstate',
    body: `<p class="mb-0">Reinstate <b>${esc(CUR_MEMBER.name)}</b>? Their accreditation is restored and a new certificate issued. This needs a valid MoF authorization and a paid membership period.</p>`,
    onSubmit: async () => { await adm(`/members/${encodeURIComponent(n)}/reinstate`, { method: 'POST' }); done(`${CUR_MEMBER.name} reinstated`); },
  });
}
function verifyRenewal(id, mofRef) {
  asyncModal({
    title: 'Verify MoF renewal', confirmText: 'Verify',
    body: `<p class="small text-body-secondary">Confirm <b>${esc(mofRef)}</b> on the Ministry of Finance register and enter the expiry date shown on the authorization.</p>
      <label class="form-label small fw-medium">Authorization valid until</label><input class="form-control" type="date" name="mofExpiry" min="${tomorrow()}" required><div class="invalid-feedback">Enter a future date.</div>`,
    onSubmit: async v => { await adm(`/renewals/${encodeURIComponent(id)}/verify`, { method: 'POST', body: v }); done('MoF renewal verified'); },
  });
}
function rejectRenewal(id) {
  asyncModal({
    title: 'Reject MoF renewal', confirmText: 'Reject', tone: 'danger',
    body: `<label class="form-label small fw-medium">Reason (sent to the member)</label><textarea class="form-control" name="reason" rows="3" required>The authorization could not be found on the Ministry of Finance register. Please upload a valid authorization.</textarea><div class="invalid-feedback">Give a reason.</div>`,
    onSubmit: async v => { await adm(`/renewals/${encodeURIComponent(id)}/reject`, { method: 'POST', body: v }); done('Renewal rejected; the member has been told'); },
  });
}
function setPortalUser(number, userId, active) {
  asyncModal({
    title: active ? 'Reactivate portal user' : 'Deactivate portal user', confirmText: active ? 'Reactivate' : 'Deactivate', tone: active ? 'primary' : 'danger',
    body: `<p class="mb-0">${active ? 'This person will be able to sign in to the member portal again.' : 'This person is signed out at once and can no longer sign in to the member portal. Use this when someone leaves the business.'}</p>`,
    onSubmit: async () => { await adm(`/members/${encodeURIComponent(number)}/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: { active } }); done(active ? 'Portal user reactivated' : 'Portal user deactivated and signed out'); },
  });
}
function inviteUser(n) {
  asyncModal({
    title: 'Invite a portal user', confirmText: 'Send invitation',
    body: `<p class="small text-body-secondary">They’ll get an email to set a password for ${esc(CUR_MEMBER.name)}’s member portal.</p>
      <div class="mb-3"><label class="form-label small fw-medium">Full name</label><input class="form-control" name="name" required><div class="invalid-feedback">Required.</div></div>
      <label class="form-label small fw-medium">Email</label><input class="form-control" type="email" name="email" required><div class="invalid-feedback">Enter a valid email.</div>`,
    onSubmit: async v => { await adm(`/members/${encodeURIComponent(n)}/users`, { method: 'POST', body: v }); done(`Invitation sent to ${v.email}`); },
  });
}

expose({ editMember, sendReminder, recordDues, suspendMember, reinstateMember, verifyRenewal, rejectRenewal, setPortalUser, inviteUser });
