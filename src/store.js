// Data store. When Supabase is configured (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY), every record lives in the shared
// `records` table and uploaded documents in the `docs` storage bucket, so all devices see the same data and changes arrive
// live. Without it, data stays in this browser's localStorage and IndexedDB, as in the original prototype.
// The app keeps working on one in-memory state object; `save` works out what changed and writes only that.
import { createClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL, ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const remote = !!(URL_ && ANON);
const db = remote ? createClient(URL_, ANON) : null;

const KEY = 'mlaz-demo-v3';
const COLS = ['members', 'apps', 'payments', 'events', 'announce', 'broadcasts', 'audit', 'registered'];

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
});

/* IDs follow the highest one in use, so they stay sequential (APP-2045, APP-2046…). Two devices creating a record at the
   same moment would pick the same ID; the database rejects the second insert and that change is reported as a conflict. */
const ID_SOURCE = { member: ['members', 'id'], app: ['apps', 'id'], pay: ['payments', 'ref'] };
export function nextId(state, kind, prefix) {
  const [col, field] = ID_SOURCE[kind];
  const n = state[col].reduce((max, x) => Math.max(max, parseInt(String(x[field]).split('-')[1], 10) || 0), 0) + 1;
  return prefix + String(n).padStart(4, '0');
}

/* ================= SHARED STORE (Supabase) ================= */
// Members, applications and payments are keyed by their own ID; other lists get a hidden `_k` key on first save.
const keyOf = (kind, x) => kind === 'members' || kind === 'apps' ? x.id : kind === 'payments' ? x.ref
  : (x._k ||= Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const known = {};  // kind → Map(key → { json, ver, ord }): what the server holds, as of our last read or write
let stateRef, onChange = () => {}, chain = Promise.resolve(), busy = false, buffered = [];

// Runs store operations one at a time; realtime events that arrive meanwhile are applied afterwards.
function serial(fn) {
  const p = chain.then(async () => {
    busy = true;
    try { return await fn(); } finally {
      busy = false;
      const evts = buffered; buffered = [];
      evts.forEach(applyEvent);
    }
  });
  chain = p.catch(() => {});
  return p;
}

// Replaces an object's contents without replacing the object, so code holding a reference to it keeps seeing current data.
function assignInPlace(x, data) { Object.keys(x).forEach(k => delete x[k]); return Object.assign(x, data); }

async function fetchAll() {
  const rows = [], PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('records').select('kind,key,data,ord,ver').order('kind').order('key').range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

// Makes the state match the server, keeping existing objects and any unsaved edits to records the server hasn't changed.
async function pull(state) {
  const rows = await fetchAll();
  COLS.forEach(c => {
    const local = new Map(state[c].map(x => [keyOf(c, x), x])), prevKnown = known[c];
    known[c] = new Map();
    const items = rows.filter(r => r.kind === c).sort((a, b) => a.ord - b.ord).map(r => {
      const x = local.get(r.key), prev = prevKnown.get(r.key);
      if (x && prev?.ver === r.ver) { known[c].set(r.key, prev); return x; }
      const item = x ? assignInPlace(x, r.data) : r.data;
      known[c].set(r.key, { json: JSON.stringify(item), ver: r.ver, ord: r.ord });
      return item;
    });
    state[c].splice(0, Infinity, ...items);
  });
  state.events.sort((a, b) => a.date.localeCompare(b.date));
}

// Compares the state with what the server holds. New items placed before every saved one (unshift) sort first on reload.
function diff(state) {
  const changes = [];
  COLS.forEach(c => {
    const arr = state[c], k = known[c], keys = arr.map(x => keyOf(c, x));
    let lo = 0, hi = -1;
    k.forEach(v => { lo = Math.min(lo, v.ord); hi = Math.max(hi, v.ord); });
    const firstKnown = keys.findIndex(key => k.has(key)), lead = firstKnown < 0 ? arr.length : firstKnown;
    arr.forEach((x, i) => {
      const key = keys[i], json = JSON.stringify(x), prev = k.get(key);
      if (!prev) changes.push({ op: 'insert', kind: c, key, data: x, json, ord: i < lead ? lo - (lead - i) : ++hi });
      else if (prev.json !== json) changes.push({ op: 'update', kind: c, key, data: x, json, ver: prev.ver, ord: prev.ord });
    });
    const live = new Set(keys);
    k.forEach((v, key) => { if (!live.has(key)) changes.push({ op: 'delete', kind: c, key, ver: v.ver }); });
  });
  return changes;
}

const isConflict = e => e?.code === '40001' || e?.code === '23505';
async function push(state) {
  const changes = diff(state);
  if (!changes.length) return { ok: true };
  const { data: vers, error } = await db.rpc('apply_changes', { changes: changes.map(({ json, ...c }) => c) });
  if (error) {
    console.error('Save failed', error);
    if (!isConflict(error)) return { ok: false };
    await pull(state).catch(() => {});
    return { ok: false, conflict: true };
  }
  changes.forEach((c, i) => c.op === 'delete' ? known[c.kind].delete(c.key) : known[c.kind].set(c.key, { json: c.json, ver: vers[i], ord: c.ord }));
  return { ok: true };
}

function applyEvent(e) {
  if (busy) return buffered.push(e);
  const { eventType, new: row, old } = e, state = stateRef;
  const kind = row?.kind ?? old?.kind, key = row?.key ?? old?.key, k = known[kind];
  if (!k) return;
  const prev = k.get(key), arr = state[kind], i = arr.findIndex(x => keyOf(kind, x) === key);
  if (eventType === 'DELETE') {
    if (!prev) return;
    k.delete(key);
    if (i >= 0) arr.splice(i, 1);
  } else {
    if (prev && prev.ver >= row.ver) return;  // our own write coming back, or older than what we have
    let item = row.data;
    if (i >= 0) item = assignInPlace(arr[i], row.data);
    else {
      const at = arr.findIndex(x => (k.get(keyOf(kind, x))?.ord ?? Infinity) > row.ord);
      arr.splice(at < 0 ? arr.length : at, 0, item);
    }
    k.set(key, { json: JSON.stringify(item), ver: row.ver, ord: row.ord });
    if (kind === 'events') arr.sort((a, b) => a.date.localeCompare(b.date));
  }
  onChange();
}

// Writes pending changes, then catches up on anything missed while the tab slept or the connection dropped.
const resync = () => serial(async () => { if ((await push(stateRef)).ok) await pull(stateRef); })
  .then(() => onChange(), e => console.error('Sync failed', e));

/* ================= PUBLIC API ================= */
// Fills `state` and keeps it up to date; `changed` is called whenever another device changes something.
export async function init(state, changed) {
  if (!remote) return Object.assign(state, loadLocal());
  stateRef = state; onChange = changed;
  COLS.forEach(c => { state[c] = []; known[c] = new Map(); });
  await serial(async () => {
    await pull(state);
    if (COLS.every(c => !state[c].length)) {  // empty database: start from the sample data
      const s = seed();
      COLS.forEach(c => state[c].push(...s[c]));
      await push(state);
    }
  });
  let subscribed = false;
  db.channel('records')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, applyEvent)
    .subscribe(status => { if (status === 'SUBSCRIBED') { if (subscribed) resync(); subscribed = true; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resync(); });
  window.addEventListener('online', resync);
}

// Resolves to { ok }, or { ok: false, conflict: true } when someone else changed the same record first (the state is then reloaded).
export function save(state) {
  if (!remote) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    return Promise.resolve({ ok: true });
  }
  return serial(() => push(state)).catch(e => { console.error('Save failed', e); return { ok: false }; });
}

// Clears all records and documents; the sample data is restored on the next load.
export async function reset() {
  if (!remote) { try { localStorage.removeItem(KEY); indexedDB.deleteDatabase(DB); } catch (e) { /* ignore */ } return; }
  const { error } = await db.from('records').delete().neq('kind', '');
  if (error) throw error;
  const bucket = db.storage.from('docs'), { data: dirs } = await bucket.list('', { limit: 1000 });
  for (const d of dirs || []) {
    const { data: files } = await bucket.list(d.name, { limit: 1000 });
    if (files?.length) await bucket.remove(files.map(f => `${d.name}/${f.name}`));
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...seed(), ...JSON.parse(raw) };
  } catch (e) { /* storage blocked or corrupt — fall back to seed */ }
  return seed();
}

/* ================= DOCUMENTS ================= */
// Uploaded documents (e.g. MoF authorizations) live in the `docs` bucket, or locally in IndexedDB since files are too large for localStorage.
const docPath = key => key.replace(':', '/');
const DB = 'mlaz-docs', STORE = 'docs';
const openDb = () => new Promise((res, rej) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});
const tx = (mode, fn) => openDb().then(idb => new Promise((res, rej) => {
  const req = fn(idb.transaction(STORE, mode).objectStore(STORE));
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
}));
export const saveDoc = (key, file) => !file ? Promise.resolve()
  : remote ? db.storage.from('docs').upload(docPath(key), file, { upsert: true, contentType: file.type || undefined })
    .then(({ error }) => { if (error) console.error('Upload failed', error); })
  : tx('readwrite', s => s.put(file, key)).catch(() => {});
export const getDoc = key => remote ? db.storage.from('docs').download(docPath(key)).then(({ data }) => data || null, () => null)
  : tx('readonly', s => s.get(key)).catch(() => null);
export const deleteDoc = key => remote ? db.storage.from('docs').remove([docPath(key)]).catch(() => {})
  : tx('readwrite', s => s.delete(key)).catch(() => {});
