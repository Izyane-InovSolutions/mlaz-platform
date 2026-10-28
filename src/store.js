// Demo data store. Everything lives in localStorage so the prototype behaves like a real app
// (changes survive reloads) without needing a backend. Swap this module for API calls later.

const KEY = 'mlaz-demo-v3';
const ago = hours => new Date(Date.now() - hours * 3600e3).toISOString();

const seed = () => ({
  members: [
    { id: 'MLA-0421', name: 'QuickLend Microfinance', town: 'Lusaka', province: 'Lusaka', tpin: '1001845523', tier: 'Gold', status: 'active', mof: 'valid', mofRef: 'MoF/ML/2024/1180', accred: 'issued', duesPaid: true, expiry: '2027-03-31', contact: 'A. Chisha', phone: '097 5xx 412', email: 'info@quicklend.zm', joined: '2024-02-10',
      activity: [{ icon: 'credit-card', tone: 'warning', title: '2026 annual dues paid', sub: 'K4,500 · MTN MoMo · 12 Feb 2026' }, { icon: 'award', tone: 'success', title: 'Accreditation issued', sub: 'After MoF verification' }] },
    { id: 'MLA-0422', name: 'Kwacha Credit Solutions', town: 'Kitwe', province: 'Copperbelt', tpin: '1002217840', tier: 'Gold', status: 'active', mof: 'valid', mofRef: 'MoF/ML/2023/0874', accred: 'issued', duesPaid: true, expiry: '2027-06-30', contact: 'P. Sinkamba', phone: '096 7xx 880', email: 'admin@kwachacredit.zm', joined: '2023-11-05' },
    { id: 'MLA-0423', name: 'ZedFunds Money Lenders', town: 'Ndola', province: 'Copperbelt', tpin: '1003391175', tier: 'Silver', status: 'active', mof: 'valid', mofRef: 'MoF/ML/2024/1422', accred: 'issued', duesPaid: false, expiry: '2026-12-31', contact: 'M. Banda', phone: '095 1xx 027', email: 'hello@zedfunds.zm', joined: '2024-07-22' },
    { id: 'MLA-0424', name: 'Lusaka Cash Advance', town: 'Lusaka', province: 'Lusaka', tpin: '1004518806', tier: 'Silver', status: 'active', mof: 'valid', mofRef: 'MoF/ML/2025/0219', accred: 'issued', duesPaid: true, expiry: '2027-01-15', contact: 'G. Sakala', phone: '096 9xx 134', email: 'ops@lusakacash.zm', joined: '2025-01-18' },
    { id: 'MLA-0425', name: 'Copperbelt Credit Ltd', town: 'Kitwe', province: 'Copperbelt', tpin: '1001207731', tier: 'Gold', status: 'active', mof: 'valid', mofRef: 'MoF/ML/2023/0612', accred: 'issued', duesPaid: true, expiry: '2027-04-30', contact: 'T. Zulu', phone: '095 3xx 167', email: 'info@cbcredit.zm', joined: '2023-09-11' },
    { id: 'MLA-0426', name: 'Southern Loans', town: 'Livingstone', province: 'Southern', tpin: '1003064412', tier: 'Bronze', status: 'lapsed', mof: 'valid', mofRef: 'MoF/ML/2024/1031', accred: 'expired', duesPaid: false, expiry: '2026-05-31', contact: 'B. Zulu', phone: '096 2xx 590', email: 'southern@loans.zm', joined: '2024-03-30' },
    { id: 'MLA-0427', name: 'Chingola Finance', town: 'Chingola', province: 'Copperbelt', tpin: '1004730958', tier: 'Silver', status: 'suspended', mof: 'expired', mofRef: 'MoF/ML/2024/1610', accred: 'revoked', duesPaid: false, expiry: '2026-02-28', contact: 'R. Mulenga', phone: '097 2xx 318', email: 'info@chingolafin.zm', joined: '2024-10-02' },
  ],
  apps: [
    { id: 'APP-2041', name: 'Solwezi Quick Loans', town: 'Solwezi', province: 'North-Western', contact: 'J. Kapenda', position: 'Managing Director', phone: '097 8xx 245', email: 'info@solweziquickloans.zm',
      pacra: '120260004117', tpin: '1003064412', tier: 'Silver', stage: 'mof_review', submitted: 'Today 08:12', mofRef: 'MoF/ML/2026/3312', mofFile: 'MoF authorization.pdf',
      director: 'Joseph Kapenda', directorNrc: '284512/11/1', pacraFile: 'Certificate of incorporation.pdf', nrcFile: 'Director NRC.jpg' },
    { id: 'APP-2042', name: 'Mazabuka Credit Hub', town: 'Mazabuka', province: 'Southern', contact: 'L. Daka', position: 'Director', phone: '095 6xx 702', email: 'hello@mazabukacredit.zm',
      pacra: '120250019832', tpin: '1005127764', tier: 'Silver', stage: 'payment_pending', submitted: 'Today 09:40', mofRef: 'MoF/ML/2026/3318', mofFile: 'MoF authorization.pdf',
      director: 'Lillian Daka', directorNrc: '199230/71/1', pacraFile: 'Certificate of incorporation.pdf', nrcFile: 'Director NRC.jpg' },
    { id: 'APP-2043', name: 'Kabwe Money Point', town: 'Kabwe', province: 'Central', contact: 'E. Banda', position: 'Owner', phone: '096 4xx 991', email: 'kabwemoneypoint@gmail.com',
      pacra: '120260002270', tpin: '1005340019', tier: 'Bronze', stage: 'details', submitted: 'Yesterday', mofRef: '—',
      director: 'Esther Banda', directorNrc: '320871/41/1', pacraFile: 'Certificate of incorporation.pdf', nrcFile: 'Director NRC.jpg' },
    { id: 'APP-2044', name: 'Chipata Cash Services', town: 'Chipata', province: 'Eastern', contact: 'P. Mumba', position: 'Managing Director', phone: '095 3xx 110', email: 'admin@chipatacash.zm',
      pacra: '120250021954', tpin: '1004982216', tier: 'Silver', stage: 'mof_review', submitted: 'Yesterday', mofRef: 'MoF/ML/2026/3301', mofFile: 'MoF authorization.pdf',
      director: 'Peter Mumba', directorNrc: '251176/51/1', pacraFile: 'Certificate of incorporation.pdf', nrcFile: 'Director NRC.jpg',
      recommendation: { by: 'John Phiri', title: 'Membership Officer', email: 'officer@mlaz.org.zm', at: ago(3), note: 'Authorization confirmed on the MoF register. TPIN active.' } },
  ],
  payments: [
    { ref: 'PAY-7781', member: 'QuickLend Microfinance', type: 'Annual dues (Gold)', amt: 4500, method: 'MTN MoMo', date: 'Today 09:41', status: 'success' },
    { ref: 'PAY-7782', member: 'Lusaka Cash Advance', type: 'Annual dues (Silver)', amt: 3000, method: 'Card', date: 'Today 09:05', status: 'success' },
    { ref: 'PAY-7783', member: 'Solwezi Quick Loans', type: 'Joining fee', amt: 2000, method: 'Airtel Money', date: 'Today 08:20', status: 'pending' },
    { ref: 'PAY-7784', member: 'Copperbelt Credit Ltd', type: 'Annual dues (Gold)', amt: 4500, method: 'Bank transfer', date: 'Yesterday', status: 'success' },
    { ref: 'PAY-7785', member: 'ZedFunds Money Lenders', type: 'Annual dues (Silver)', amt: 3000, method: 'MTN MoMo', date: 'Yesterday', status: 'failed' },
  ],
  events: [
    { name: 'Responsible Lending & BoZ Compliance Workshop', date: '2026-10-28', town: 'Kitwe', type: 'Training', reg: 64, cap: 80, price: 0 },
    { name: 'Digital Lending & Credit Scoring Briefing', date: '2026-11-05', town: 'Online', type: 'Webinar', reg: 210, cap: 500, price: 250 },
    { name: 'MLAZ Annual General Meeting 2026', date: '2026-11-20', town: 'Lusaka — Mulungushi', type: 'AGM', reg: 142, cap: 200, price: 500 },
  ],
  announce: [
    { title: '2027 membership renewals now open', date: '2026-09-28', tag: 'Renewals', body: 'Renew before 31 Dec to keep your accreditation active and your listing in the public directory.' },
    { title: 'New: upload your MoF authorization online', date: '2026-09-20', tag: 'Platform', body: 'Members can now upload and renew their Ministry of Finance money-lending authorization directly in the portal.' },
    { title: 'BoZ interest-disclosure guidance circulated', date: '2026-09-10', tag: 'Compliance', body: 'Please review the updated disclosure guidance in the resource library and apply by month-end.' },
  ],
  broadcasts: [],
  audit: [
    { at: ago(3), by: 'John Phiri (Membership Officer)', target: 'APP-2044', action: 'Recommended for approval', note: 'Authorization confirmed on the MoF register. TPIN active.' },
    { at: ago(5), by: 'J. Kapenda (applicant)', target: 'APP-2041', action: 'Application submitted', note: 'MoF authorization, PACRA certificate and director NRC uploaded' },
    { at: ago(20), by: 'Grace Mwansa (Secretariat Admin)', target: 'APP-2042', action: 'Approved (checker)', note: 'Recommended by John Phiri' },
    { at: ago(22), by: 'John Phiri (Membership Officer)', target: 'APP-2042', action: 'Recommended for approval', note: '' },
    { at: ago(26), by: 'P. Mumba (applicant)', target: 'APP-2044', action: 'Application submitted', note: 'MoF authorization, PACRA certificate and director NRC uploaded' },
    { at: ago(30), by: 'E. Banda (applicant)', target: 'APP-2043', action: 'Application submitted', note: 'MoF authorization to follow' },
    { at: ago(48), by: 'L. Daka (applicant)', target: 'APP-2042', action: 'Application submitted', note: 'MoF authorization, PACRA certificate and director NRC uploaded' },
  ],
  registered: [],
  expenses: [
    { ref: 'EXP-0006', date: '2026-10-12', category: 'Venue booking', description: 'Hotel conference room hire, 1 day', payee: 'Edinburgh Hotel, Kitwe', amt: 9500, method: 'Bank transfer', event: 'Responsible Lending & BoZ Compliance Workshop', by: 'Grace Mwansa (Secretariat Admin)' },
    { ref: 'EXP-0005', date: '2026-10-10', category: 'Catering', description: 'Lunch and teas for 80 delegates', payee: 'Copper Kitchen Caterers', amt: 12000, method: 'Bank transfer', event: 'Responsible Lending & BoZ Compliance Workshop', by: 'Grace Mwansa (Secretariat Admin)' },
    { ref: 'EXP-0004', date: '2026-10-06', category: 'Venue booking', description: 'Main hall deposit (50%)', payee: 'Mulungushi International Conference Centre', amt: 25000, method: 'Bank transfer', event: 'MLAZ Annual General Meeting 2026', by: 'Grace Mwansa (Secretariat Admin)' },
    { ref: 'EXP-0003', date: '2026-10-03', category: 'Software & subscriptions', description: 'Webinar platform licence, 500 attendees', payee: 'Zoom Video Communications', amt: 1850, method: 'Card', event: 'Digital Lending & Credit Scoring Briefing', by: 'Grace Mwansa (Secretariat Admin)' },
    { ref: 'EXP-0002', date: '2026-10-01', category: 'Office & admin', description: 'Secretariat office rent, October', payee: 'Cairo Road Properties Ltd', amt: 14000, method: 'Bank transfer', event: '', by: 'Grace Mwansa (Secretariat Admin)' },
    { ref: 'EXP-0001', date: '2026-09-25', category: 'Printing & materials', description: 'Certificates, letterheads and workshop handbooks', payee: 'Lusaka Print House', amt: 4200, method: 'Mobile money', event: '', by: 'Grace Mwansa (Secretariat Admin)' },
  ],
  seq: { member: 427, app: 2044, pay: 7785, exp: 6 },
});

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const state = { ...seed(), ...JSON.parse(raw) };
      state.seq = { ...seed().seq, ...state.seq };
      // Data saved before event ticketing has no prices: take them from the seed.
      seed().events.forEach(d => { const e = state.events.find(x => x.name === d.name); if (e && e.price === undefined) e.price = d.price; });
      return state;
    }
  } catch (e) { /* storage blocked or corrupt — fall back to seed */ }
  return seed();
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

export function reset() {
  try { localStorage.removeItem(KEY); indexedDB.deleteDatabase(DB); } catch (e) { /* ignore */ }
}

export function nextId(state, kind, prefix) {
  state.seq[kind] += 1;
  return prefix + String(state.seq[kind]).padStart(4, '0');
}

// Uploaded documents (e.g. MoF authorizations) are kept in IndexedDB, since files are too large for localStorage.
const DB = 'mlaz-docs', STORE = 'docs';
const openDb = () => new Promise((res, rej) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});
const tx = (mode, fn) => openDb().then(db => new Promise((res, rej) => {
  const req = fn(db.transaction(STORE, mode).objectStore(STORE));
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
}));
export const saveDoc = (key, file) => tx('readwrite', s => s.put(file, key)).catch(() => {});
export const getDoc = key => tx('readonly', s => s.get(key)).catch(() => null);
export const deleteDoc = key => tx('readwrite', s => s.delete(key)).catch(() => {});
