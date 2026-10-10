// Demo data store. Everything lives in localStorage so the prototype behaves like a real app
// (changes survive reloads) without needing a backend. Swap this module for API calls later.

const KEY = 'mlaz-demo-v2';

const seed = () => ({
  members: [
    { id: 'MLA-0421', name: 'QuickLend Microfinance', town: 'Lusaka', tier: 'Gold', status: 'active', mof: 'valid', mofRef: 'MoF/ML/2024/1180', accred: 'issued', duesPaid: true, expiry: '2027-03-31', contact: 'A. Chisha', phone: '097 5xx 412', email: 'info@quicklend.zm', joined: '2024-02-10',
      activity: [{ icon: 'credit-card', tone: 'warning', title: '2026 annual dues paid', sub: 'K4,500 · MTN MoMo · 12 Feb 2026' }, { icon: 'award', tone: 'success', title: 'Accreditation issued', sub: 'After MoF verification' }] },
    { id: 'MLA-0422', name: 'Kwacha Credit Solutions', town: 'Kitwe', tier: 'Gold', status: 'active', mof: 'valid', mofRef: 'MoF/ML/2023/0874', accred: 'issued', duesPaid: true, expiry: '2027-06-30', contact: 'P. Sinkamba', phone: '096 7xx 880', email: 'admin@kwachacredit.zm', joined: '2023-11-05' },
    { id: 'MLA-0423', name: 'ZedFunds Money Lenders', town: 'Ndola', tier: 'Silver', status: 'active', mof: 'valid', mofRef: 'MoF/ML/2024/1422', accred: 'issued', duesPaid: false, expiry: '2026-12-31', contact: 'M. Banda', phone: '095 1xx 027', email: 'hello@zedfunds.zm', joined: '2024-07-22' },
    { id: 'MLA-0424', name: 'Lusaka Cash Advance', town: 'Lusaka', tier: 'Silver', status: 'active', mof: 'valid', mofRef: 'MoF/ML/2025/0219', accred: 'issued', duesPaid: true, expiry: '2027-01-15', contact: 'G. Sakala', phone: '096 9xx 134', email: 'ops@lusakacash.zm', joined: '2025-01-18' },
    { id: 'MLA-0425', name: 'Copperbelt Credit Ltd', town: 'Kitwe', tier: 'Gold', status: 'active', mof: 'valid', mofRef: 'MoF/ML/2023/0612', accred: 'issued', duesPaid: true, expiry: '2027-04-30', contact: 'T. Zulu', phone: '095 3xx 167', email: 'info@cbcredit.zm', joined: '2023-09-11' },
    { id: 'MLA-0426', name: 'Southern Loans', town: 'Livingstone', tier: 'Bronze', status: 'lapsed', mof: 'valid', mofRef: 'MoF/ML/2024/1031', accred: 'expired', duesPaid: false, expiry: '2026-05-31', contact: 'B. Zulu', phone: '096 2xx 590', email: 'southern@loans.zm', joined: '2024-03-30' },
    { id: 'MLA-0427', name: 'Chingola Finance', town: 'Chingola', tier: 'Silver', status: 'suspended', mof: 'expired', mofRef: 'MoF/ML/2024/1610', accred: 'revoked', duesPaid: false, expiry: '2026-02-28', contact: 'R. Mulenga', phone: '097 2xx 318', email: 'info@chingolafin.zm', joined: '2024-10-02' },
  ],
  apps: [
    { id: 'APP-2041', name: 'Solwezi Quick Loans', town: 'Solwezi', contact: 'J. Kapenda', phone: '097 8xx 245', email: 'info@solweziquickloans.zm', pacra: '120260004117', tier: 'Silver', stage: 'mof_review', submitted: 'Today 08:12', mofRef: 'MoF/ML/2026/3312' },
    { id: 'APP-2042', name: 'Mazabuka Credit Hub', town: 'Mazabuka', contact: 'L. Daka', phone: '095 6xx 702', email: 'hello@mazabukacredit.zm', pacra: '120250019832', tier: 'Silver', stage: 'payment_pending', submitted: 'Today 09:40', mofRef: 'MoF/ML/2026/3318' },
    { id: 'APP-2043', name: 'Kabwe Money Point', town: 'Kabwe', contact: 'E. Banda', phone: '096 4xx 991', email: 'kabwemoneypoint@gmail.com', pacra: '120260002270', tier: 'Bronze', stage: 'details', submitted: 'Yesterday', mofRef: '—' },
    { id: 'APP-2044', name: 'Chipata Cash Services', town: 'Chipata', contact: 'P. Mumba', phone: '095 3xx 110', email: 'admin@chipatacash.zm', pacra: '120250021954', tier: 'Silver', stage: 'ready_accredit', submitted: 'Yesterday', mofRef: 'MoF/ML/2026/3301' },
  ],
  payments: [
    { ref: 'PAY-7781', member: 'QuickLend Microfinance', type: 'Annual dues (Gold)', amt: 4500, method: 'MTN MoMo', date: 'Today 09:41', status: 'success' },
    { ref: 'PAY-7782', member: 'Lusaka Cash Advance', type: 'Annual dues (Silver)', amt: 3000, method: 'Card', date: 'Today 09:05', status: 'success' },
    { ref: 'PAY-7783', member: 'Solwezi Quick Loans', type: 'Joining fee', amt: 2000, method: 'Airtel Money', date: 'Today 08:20', status: 'pending' },
    { ref: 'PAY-7784', member: 'Copperbelt Credit Ltd', type: 'Annual dues (Gold)', amt: 4500, method: 'Bank transfer', date: 'Yesterday', status: 'success' },
    { ref: 'PAY-7785', member: 'ZedFunds Money Lenders', type: 'Annual dues (Silver)', amt: 3000, method: 'MTN MoMo', date: 'Yesterday', status: 'failed' },
  ],
  events: [
    { name: 'Responsible Lending & BoZ Compliance Workshop', date: '2026-10-28', town: 'Kitwe', type: 'Training', reg: 64, cap: 80 },
    { name: 'Digital Lending & Credit Scoring Briefing', date: '2026-11-05', town: 'Online', type: 'Webinar', reg: 210, cap: 500 },
    { name: 'MLAZ Annual General Meeting 2026', date: '2026-11-20', town: 'Lusaka — Mulungushi', type: 'AGM', reg: 142, cap: 200 },
  ],
  announce: [
    { title: '2027 membership renewals now open', date: '2026-09-28', tag: 'Renewals', body: 'Renew before 31 Dec to keep your accreditation active and your listing in the public directory.' },
    { title: 'New: upload your MoF authorization online', date: '2026-09-20', tag: 'Platform', body: 'Members can now upload and renew their Ministry of Finance money-lending authorization directly in the portal.' },
    { title: 'BoZ interest-disclosure guidance circulated', date: '2026-09-10', tag: 'Compliance', body: 'Please review the updated disclosure guidance in the resource library and apply by month-end.' },
  ],
  broadcasts: [],
  registered: [],
  seq: { member: 427, app: 2044, pay: 7785 },
});

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...seed(), ...JSON.parse(raw) };
  } catch (e) { /* storage blocked or corrupt — fall back to seed */ }
  return seed();
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function nextId(state, kind, prefix) {
  state.seq[kind] += 1;
  return prefix + String(state.seq[kind]).padStart(4, '0');
}
