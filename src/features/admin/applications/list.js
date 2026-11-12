import { expose, on } from '../../../core/events.js';
import { rerender } from '../../../core/navigation.js';
import { esc, fmtDate, icon, note, pageHeader, pager, tableCard } from '../../../shared/ui/index.js';
import { tierBadge } from '../../common/index.js';
import { adm, qs } from '../shared/api.js';
import { appBadge, listToolbar } from '../shared/ui.js';
import { appDetail } from './detail.js';

/* ================= APPLICATIONS ================= */
const ASTAGES = [['OPEN', 'Open'], ['MOF_REVIEW', 'MoF review'], ['AWAITING_APPROVAL', 'Awaiting approval'], ['PAYMENT_PENDING', 'Awaiting payment'], ['DETAILS', 'Awaiting documents'], ['ACCREDITED', 'Accredited'], ['REJECTED', 'Not approved'], ['ALL', 'All']];
let AS = { stage: 'OPEN', q: '', page: 1 };
const setAStage = k => { AS = { ...AS, stage: k, page: 1 }; rerender(); };
const setAQuery = q => { AS = { ...AS, q, page: 1 }; rerender(); };
const setAPage = p => { AS.page = p; rerender(); };

export async function applications(ref) {
  if (ref) return appDetail(ref);
  const r = await adm(`/applications${qs({ stage: AS.stage === 'ALL' ? '' : AS.stage, q: AS.q, page: AS.page, pageSize: 25 })}`);
  return pageHeader('Applications', 'Self-onboarded lenders progressing to accredited membership', `<a class="btn btn-primary" href="#/apply" target="_blank">${icon('plus-lg', 'me-1')} New application</a>`)
    + note('light border', 'info-circle', 'The Ministry of Finance authorization is verified <b>first</b>: one officer recommends and a second approves. Only then can the applicant pay, and accreditation is issued automatically on payment.')
    + tableCard(['Reference', 'Applicant', 'Town', 'Tier', 'MoF reference', 'Stage', 'Submitted'], r.items.map(a => `<tr class="clickable" ${on('click', 'nav', `app/applications/${encodeURIComponent(a.ref)}`)}>
      <td class="small font-monospace">${esc(a.ref)}</td><td><div class="fw-medium">${esc(a.businessName)}</div>${a.recommendedBy ? `<div class="small text-body-secondary">Recommended by ${esc(a.recommendedBy)}</div>` : ''}</td><td>${esc(a.town)}</td><td>${tierBadge(a.tier)}</td>
      <td class="small">${esc(a.mofRef || '—')}</td><td>${appBadge(a)}</td><td class="small text-body-secondary">${fmtDate(a.submittedAt)}</td></tr>`).join(''), 'No applications here.', pager(r, 'setAPage'),
      listToolbar({ filters: ASTAGES, active: AS.stage, filterFn: 'setAStage', label: 'Show', q: AS.q, searchFn: 'setAQuery', placeholder: 'Search by business name, reference or town' }));
}

expose({ setAStage, setAQuery, setAPage });
