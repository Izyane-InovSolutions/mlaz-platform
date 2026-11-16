import { can } from '../../../core/auth/permissions.js';
import { getSession } from '../../../core/auth/session-store.js';
import { EL, expose, on } from '../../../core/events.js';
import { nav } from '../../../core/navigation.js';
import { K, asyncModal, done, empty, esc, fmtDate, fmtDateTime, icon, infoRow as info, listItem, lower, note, pageHeader, stepper, toast } from '../../../shared/ui/index.js';
import { tierBadge } from '../../common/index.js';
import { adm } from '../shared/api.js';
import { DOC_KIND, appBadge, crumb, offlineFields, paymentRow, tomorrow } from '../shared/ui.js';

const JOURNEY = ['Submitted', 'MoF authorization', 'Verification', 'Payment', 'Accredited'];
const STAGE_IDX = { DETAILS: 1, MOF_REVIEW: 2, PAYMENT_PENDING: 3, ACCREDITED: 5 };

let CUR_APP = null;
// The automated checks, as list rows. `full` keeps every detail (the drawer); otherwise each detail is cut to one line
// so the card fits beside "Review and decision".
function checkRows(a, full) {
  const c = a.checks;
  const row = (ok, title, sub, bad = 'warning') => listItem(ok ? 'check-circle-fill' : 'exclamation-triangle-fill', ok ? 'success' : bad, title, full ? sub : `<span class="d-block text-truncate">${sub}</span>`);
  return row(c.tpinValid, c.tpinValid ? 'TPIN format valid' : 'TPIN is not valid', `${esc(a.business.tpin)} · ZRA register lookup is not connected yet; confirm manually`, 'danger')
    + row(!c.duplicates.length, c.duplicates.length ? 'Possible duplicate' : 'No duplicates found', c.duplicates.length
      ? c.duplicates.map(d => `Same ${esc(d.matches.join(', '))} as <a href="#/app/${d.type === 'member' ? 'members' : 'applications'}/${encodeURIComponent(d.ref)}">${esc(d.name)}</a> (${esc(d.type)} ${esc(d.ref)}, ${esc(lower(d.status).replace('_', ' '))})`).join('<br>')
      : 'Checked against all members and open applications by TPIN, PACRA no., name, email and phone', 'danger')
    + row(!c.missingDocuments.length, c.missingDocuments.length ? 'Documents incomplete' : 'All documents received', c.missingDocuments.length ? `Missing: ${c.missingDocuments.map(k => DOC_KIND[k]).join(', ')}` : 'MoF authorization, PACRA certificate and director NRC');
}
// On large screens the card takes the height of "Review and decision" (see .fit-col) and clips its rows; "View all"
// opens the drawer with every check in full.
const checksCard = a => `<div class="card fit-col-card"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Automated checks</h2>${a.checks.flags.length ? `<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis border border-warning-subtle">${a.checks.flags.length} flagged</span>` : ''}</div>
  <div class="list-group list-group-flush fit-col-body">${checkRows(a, false)}</div>
  <div class="card-footer bg-white text-end"><button class="btn btn-sm btn-outline-primary" type="button" data-bs-toggle="offcanvas" data-bs-target="#checks-drawer" aria-controls="checks-drawer">View all checks ${icon('arrow-right', 'ms-1')}</button></div></div>`;
const checksDrawer = a => `<div class="offcanvas offcanvas-end" tabindex="-1" id="checks-drawer" aria-labelledby="checks-drawer-title">
  <div class="offcanvas-header border-bottom"><div><h2 class="h5 mb-0" id="checks-drawer-title">Automated checks</h2><div class="small text-body-secondary">${esc(a.business.name)} · ${esc(a.ref)}</div></div><button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button></div>
  <div class="offcanvas-body p-0"><div class="list-group list-group-flush">${checkRows(a, true)}</div></div></div>`;
function docsCard(a) {
  const detail = { MOF_AUTHORIZATION: `Ref ${esc(a.mofRef || '—')}${a.mofExpiry ? ` · expires ${fmtDate(a.mofExpiry)}` : ''}`, PACRA_CERTIFICATE: `PACRA ${esc(a.business.pacra)}`, DIRECTOR_NRC: `${esc(a.director.name)} · NRC ${esc(a.director.nrc)}` };
  const docs = [...a.documents].sort((x, y) => x.superseded - y.superseded);
  return `<div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Documents</h2></div><div class="list-group list-group-flush">
    ${docs.map(d => listItem(d.kind === 'DIRECTOR_NRC' ? 'person-vcard' : d.kind === 'PROOF_OF_PAYMENT' ? 'receipt' : 'file-earmark-text', d.superseded ? 'secondary' : 'info',
      `${DOC_KIND[d.kind]}${d.superseded ? ' <span class="badge bg-secondary-subtle text-secondary-emphasis">Replaced</span>' : ''}`, `${esc(d.filename)}${detail[d.kind] && !d.superseded ? ` · ${detail[d.kind]}` : ''} · ${fmtDate(d.uploadedAt)}`,
      can('documents:read') ? `<button class="btn btn-sm btn-outline-primary text-nowrap" ${on('click', 'viewDoc', d.id, `${DOC_KIND[d.kind]} · ${a.business.name}`)}>${icon('eye', 'me-1')} View</button>` : '')).join('') || empty('No documents uploaded.', 'folder')}
  </div></div>`;
}
function decision(a) {
  const rec = a.recommendation, ref = esc(a.ref), refArg = a.ref, myId = getSession()?.userId;
  const reject = can('applications:approve') ? `<button class="btn btn-outline-danger" ${on('click', 'rejectApp', refArg)}>Reject application</button>` : '';
  if (a.stage === 'DETAILS') return (a.returnNote ? note('danger', 'arrow-return-left', `Returned to applicant: ${esc(a.returnNote)}`) : '')
    + note('warning', 'hourglass', `The applicant has not yet uploaded their MoF authorization. They can do so from the tracking link in their confirmation email (reference <b>${ref}</b>).`)
    + `<div class="d-flex flex-wrap gap-2">${reject}</div>`;
  if (a.stage === 'MOF_REVIEW' && !rec) {
    if (!can('applications:recommend')) return note('info', 'hourglass-split', 'Awaiting review and a recommendation from a Membership Officer.') + `<div class="d-flex flex-wrap gap-2">${reject}</div>`;
    return note('info', 'search', '<b>Step 1 of 2 (maker).</b> Check the documents and the Ministry of Finance register, then recommend approval. A second officer must approve.')
      + `<div class="d-flex flex-wrap gap-2">${reject}${can('applications:return') ? `<button class="btn btn-outline-danger" ${on('click', 'returnApp', refArg)}>Return to applicant</button>` : ''}<button class="btn btn-primary" ${on('click', 'recommendApp', refArg)}>${icon('person-check', 'me-1')} Recommend approval</button></div>`;
  }
  if (a.stage === 'MOF_REVIEW') {
    const by = note('light border', 'person-check', `Recommended by <b>${esc(rec.by)}</b>${rec.title ? ` (${esc(rec.title)})` : ''} · ${fmtDateTime(rec.at)}${rec.note ? `<div class="mt-1 fst-italic">“${esc(rec.note)}”</div>` : ''}${a.mofExpiry ? `<div class="mt-1">MoF authorization valid until ${fmtDate(a.mofExpiry)}</div>` : ''}`);
    if (rec.userId === myId) return by + note('warning', 'shield-lock', '<b>Maker-checker:</b> you made this recommendation, so a different officer (the Secretariat Admin) must approve it.');
    if (!can('applications:approve')) return by + note('info', 'hourglass-split', 'Awaiting approval by the Secretariat Admin.');
    return by + note('info', 'clipboard-check', '<b>Step 2 of 2 (checker).</b> Review the recommendation, the documents and the automated checks, then approve or decline.')
      + `<div class="d-flex flex-wrap gap-2">${reject}<button class="btn btn-outline-danger" ${on('click', 'declineRec', refArg)}>Decline recommendation</button><button class="btn btn-primary" ${on('click', 'approveApp', refArg)}>${icon('check-lg', 'me-1')} Approve</button></div>`;
  }
  if (a.stage === 'PAYMENT_PENDING') {
    const pending = a.payments.find(p => p.status === 'PENDING');
    if (pending?.method === 'BANK_TRANSFER' && pending.hasProof) return note('info', 'bank', `The applicant paid ${K(pending.amount)} by bank transfer (ref ${esc(pending.bankRef)}) and uploaded proof of payment. Confirming it issues the accreditation certificate automatically.`)
      + (can('payments:confirm') ? `<button class="btn btn-primary" ${on('click', 'reviewPayment', pending.ref)}>${icon('file-earmark-check', 'me-1')} Review proof of payment</button>` : note('light border', 'info-circle', 'MLAZ Finance will confirm the transfer.'));
    return note('warning', 'credit-card', `Approved. Awaiting ${K(a.fees.total)} from the applicant (joining fee ${K(a.fees.joiningFee)} + ${esc(a.business.tier)} dues ${K(a.fees.annualDues)}). The accreditation certificate is issued automatically as soon as payment is received.${pending ? `<div class="mt-1">Payment ${esc(pending.ref)} by ${esc(pending.methodLabel)} is in progress.</div>` : ''}`)
      + `<div class="d-flex flex-wrap gap-2">${reject}${can('payments:record') ? `<button class="btn btn-outline-primary" ${on('click', 'recordAppPayment', refArg)}>Record offline payment</button>` : ''}</div>`;
  }
  if (a.stage === 'REJECTED') return note('danger', 'x-octagon', `<b>Not approved.</b> ${esc(a.rejectionReason || '')}`);
  return note('success', 'award', `Accredited as member <b>${esc(a.memberNumber)}</b>. The certificate was generated automatically on payment.`)
    + `<div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-secondary" ${on('click', 'viewFile', `/admin/members/${encodeURIComponent(a.memberNumber)}/certificate.pdf`, EL, 'Accreditation certificate')}>${icon('award', 'me-1')} Certificate</button><a class="btn btn-primary" href="#/app/members/${encodeURIComponent(a.memberNumber)}">Open member record</a></div>`;
}
export async function appDetail(ref) {
  const a = CUR_APP = await adm(`/applications/${encodeURIComponent(ref)}`);
  return pageHeader(esc(a.business.name), `${esc(a.ref)} · ${esc(a.business.town)} · submitted ${fmtDateTime(a.submittedAt)}`, appBadge(a), crumb('applications', 'Applications', a.business.name))
    + (STAGE_IDX[a.stage] ? `<div class="card mb-3"><div class="card-body py-4">${stepper(JOURNEY, STAGE_IDX[a.stage])}</div></div>` : '')
    + `<div class="row g-3 mb-3">
      <div class="col-lg-7"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Review and decision</h2></div><div class="card-body">${decision(a)}</div></div></div>
      <div class="col-lg-5 fit-col">${checksCard(a)}</div>
    </div>
    <div class="row g-3">
      <div class="col-lg-7"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Applicant details</h2></div><div class="card-body">
        ${info('Business name', esc(a.business.name))}${info('PACRA no.', esc(a.business.pacra))}${info('ZRA TPIN', esc(a.business.tpin))}${info('Location', esc([a.business.town, a.business.province].join(', ')))}${info('Address', esc(a.business.address || '—'))}
        ${info('Contact', esc(`${a.contact.name}, ${a.contact.position}`))}${info('Director', esc(`${a.director.name} · ${a.director.nrc}`))}${info('Phone', esc(a.contact.phone))}${info('Email', esc(a.contact.email))}${info('Tier', tierBadge(a.business.tier))}${info('Fees on approval', K(a.fees.total))}
      </div></div></div>
      <div class="col-lg-5">${docsCard(a)}</div>
    </div>
    ${a.payments.length ? `<div class="card mt-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Payments</h2></div><div class="table-responsive"><table class="table table-sm align-middle mb-0 small"><thead><tr><th>Reference</th><th>Date</th><th>Description</th><th>Method</th><th class="text-end">Amount</th><th>Status</th><th></th></tr></thead><tbody>${a.payments.map(p => paymentRow(p, { payer: false })).join('')}</tbody></table></div></div>` : ''}
    ${checksDrawer(a)}`;
}
const appAction = (path, body) => adm(`/applications/${encodeURIComponent(CUR_APP.ref)}/${path}`, { method: 'POST', body });
function recommendApp() {
  const flags = CUR_APP.checks.flags;
  asyncModal({
    title: 'Recommend for approval', confirmText: 'Send for approval',
    body: `${flags.length ? note('warning', 'exclamation-triangle', `Automated checks flagged: <b>${esc(flags.join(', '))}</b>. Explain in your note why you still recommend approval.`) : ''}
      <p class="small text-body-secondary">A second officer must approve before the applicant is asked to pay.</p>
      <div class="mb-3"><label class="form-label small fw-medium">MoF authorization valid until</label><input class="form-control" type="date" name="mofExpiry" min="${tomorrow()}" required><div class="invalid-feedback">Enter the future expiry date shown on the authorization.</div></div>
      <label class="form-label small fw-medium">Note for the approver</label><textarea class="form-control" name="note" rows="3" ${flags.length ? 'required minlength="10"' : ''}>${flags.length ? '' : 'Authorization confirmed on the Ministry of Finance register.'}</textarea><div class="invalid-feedback">At least 10 characters explaining the flagged checks.</div>`,
    onSubmit: async v => { await appAction('recommend', v); done('Sent to a second officer for approval'); },
  });
}
function approveApp() {
  asyncModal({
    title: 'Approve application', confirmText: 'Approve',
    body: `<p class="mb-0">Approve the MoF authorization for <b>${esc(CUR_APP.business.name)}</b>, recommended by ${esc(CUR_APP.recommendation.by)}? The applicant will be sent a payment link for ${K(CUR_APP.fees.total)}.</p>`,
    onSubmit: async () => { await appAction('approve'); done('Approved. Payment link sent to the applicant'); },
  });
}
const reasonModal = (title, confirmText, prefill, path, msg, help = 'The application goes back to the maker for another review.') => asyncModal({
  title, confirmText, tone: 'danger',
  body: `<p class="small text-body-secondary">${help}</p><label class="form-label small fw-medium">Reason</label><textarea class="form-control" name="reason" rows="3" required>${esc(prefill)}</textarea><div class="invalid-feedback">Give a reason.</div>`,
  onSubmit: async v => { await appAction(path, { reason: v.reason }); done(msg); },
});
const declineRec = () => reasonModal('Decline recommendation', 'Decline', '', 'decline-recommendation', 'Recommendation declined; the officer has been told');
const returnApp = () => reasonModal('Return to applicant', 'Return application', 'Authorization reference not found on the Ministry of Finance register. Please upload a valid authorization.', 'return', 'Application returned to the applicant', 'The reason is emailed to the applicant, who can upload a new authorization.');
const rejectApp = () => reasonModal('Reject application', 'Reject', '', 'reject', 'Application rejected; the applicant has been told', 'This closes the application. The reason is emailed to the applicant.');
function recordAppPayment() {
  asyncModal({
    title: 'Record offline payment', confirmText: 'Record payment',
    body: `<p class="small text-body-secondary">Record ${K(CUR_APP.fees.total)} received from ${esc(CUR_APP.business.name)} outside the online checkout. The accreditation certificate is issued automatically.</p>${offlineFields('Reference')}`,
    onSubmit: async v => {
      const r = await appAction('offline-payment', v);
      toast(`Payment recorded. Accredited as ${r.memberNumber}`);
      nav(`app/members/${encodeURIComponent(r.memberNumber)}`);
    },
  });
}

expose({ recommendApp, approveApp, declineRec, returnApp, rejectApp, recordAppPayment });
