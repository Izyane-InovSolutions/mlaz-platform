// Simulated credit bureau. Every NRC maps to the same made-up person and score each time it is looked up,
// so the demo behaves like a real bureau without one. Swap `lookup` for the bureau's API later.

export const GOOD_SCORE = 600; // 600 and above is good, below is bad
export const SCORE_MIN = 300, SCORE_MAX = 850;
export const NRC_PATTERN = '[0-9]{6}/[0-9]{2}/[0-9]';
export const isNrc = s => new RegExp(`^${NRC_PATTERN}$`).test(s);
export const isGood = score => score >= GOOD_SCORE;

const FIRST = ['Mwila', 'Chanda', 'Bwalya', 'Mulenga', 'Natasha', 'Kondwani', 'Thandiwe', 'Musonda', 'Chileshe', 'Lubinda', 'Mutale', 'Namakau', 'Kabwe', 'Mapalo', 'Chipo', 'Luyando', 'Mwape', 'Nalukui', 'Kelvin', 'Precious', 'Bupe', 'Inonge', 'Jacob', 'Ruth', 'Emmanuel', 'Grace', 'Chola', 'Mubanga'];
const LAST = ['Banda', 'Phiri', 'Mwale', 'Zulu', 'Tembo', 'Lungu', 'Mumba', 'Chisenga', 'Sakala', 'Daka', 'Mulenga', 'Kapembwa', 'Sichone', 'Mwansa', 'Nkonde', 'Simwanza', 'Hamoonga', 'Siame', 'Ngoma', 'Kunda', 'Mubita', 'Chirwa'];
const TOWNS = ['Lusaka', 'Kitwe', 'Ndola', 'Kabwe', 'Livingstone', 'Chingola', 'Mufulira', 'Chipata', 'Kasama', 'Solwezi', 'Mazabuka', 'Choma', 'Mongu', 'Mansa'];
const EMPLOYERS = ['Ministry of Health', 'Ministry of Education', 'Zambia Police Service', 'ZESCO', 'Zambia Sugar', 'First Quantum Minerals', 'Konkola Copper Mines', 'Shoprite Zambia', 'Lusaka City Council', 'Self-employed (trader)', 'Self-employed (farmer)', 'Zanaco', 'Airtel Zambia', 'University Teaching Hospital'];
const LENDERS = ['QuickLend Microfinance', 'Kwacha Credit Solutions', 'ZedFunds Money Lenders', 'Lusaka Cash Advance', 'Copperbelt Credit Ltd', 'Bayport Financial Services', 'Madison Finance', 'Izwe Loans'];

// Deterministic random numbers from a string, so a given NRC always produces the same record.
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const round = (n, to) => Math.round(n / to) * to;

/* Returns the bureau record for an NRC, or null when the bureau has no file (about 1 in 12 NRCs). */
export function lookup(nrc, { mustExist = false } = {}) {
  const r = rng(`nrc:${nrc}`);
  if (r() < 0.08 && !mustExist) return null;
  const score = Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(SCORE_MIN + (r() + r() + r()) / 3 * 1.15 * (SCORE_MAX - SCORE_MIN))));
  const q = (score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN); // 0 (worst) … 1 (best)
  const first = pick(r, FIRST), last = pick(r, LAST), age = int(r, 21, 64), born = new Date().getFullYear() - age;
  const activeLoans = q > 0.7 ? int(r, 0, 2) : int(r, 1, 4);
  return {
    nrc, name: `${first} ${last}`, dob: `${born}-${String(int(r, 1, 12)).padStart(2, '0')}-${String(int(r, 1, 28)).padStart(2, '0')}`,
    phone: `09${pick(r, ['5', '6', '7'])} ${int(r, 100, 999)} ${int(r, 100, 999)}`, town: pick(r, TOWNS), employer: pick(r, EMPLOYERS),
    income: round(int(r, 3500, 28000), 100), score,
    onTime: Math.min(100, Math.round(55 + q * 45 - r() * 8)),
    activeLoans, totalOwed: activeLoans ? round(activeLoans * int(r, 2000, 15000) * (1.4 - q), 50) : 0,
    defaults: q > 0.55 ? 0 : int(r, q < 0.3 ? 1 : 0, 3),
    enquiries: int(r, 0, q > 0.6 ? 3 : 8),
    lenders: [...new Set(Array.from({ length: activeLoans }, () => pick(r, LENDERS)))],
  };
}

/* A member's own loan book: simulated customers, each with a bureau record and a loan with that member. */
export function customersOf(memberId, count = 18) {
  const r = rng(`book:${memberId}`);
  return Array.from({ length: count }, () => {
    const nrc = `${int(r, 100000, 399999)}/${int(r, 10, 89)}/1`, c = lookup(nrc, { mustExist: true });
    const amount = round(int(r, 1500, 25000), 500), paid = r();
    const status = !isGood(c.score) && r() < 0.6 ? 'arrears' : paid > 0.85 ? 'closed' : 'current';
    const daysAgo = int(r, 10, 400), issued = new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
    return { ...c, loan: { amount, balance: status === 'closed' ? 0 : round(amount * (1 - paid * 0.8), 50), status, issued } };
  });
}
