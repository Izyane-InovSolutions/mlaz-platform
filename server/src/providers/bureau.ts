import { config } from '../config.js';

// Credit bureau adapter. The simulated driver is a port of the prototype's src/bureau.js: each NRC always maps to the
// same made-up person and score. Swap in the real bureau's API behind the same interface.

export const GOOD_SCORE = 600;
export const SCORE_MIN = 300, SCORE_MAX = 850;

export interface BureauRecord {
  nrc: string;
  name: string;
  dob: string;
  phone: string;
  town: string;
  employer: string;
  income: number;
  score: number;
  onTime: number;
  activeLoans: number;
  totalOwed: number;
  defaults: number;
  enquiries: number;
  lenders: string[];
}

export interface CreditBureau {
  /** Returns the bureau record for an NRC, or null when the bureau has no file. */
  lookup(nrc: string): Promise<BureauRecord | null>;
}

const FIRST = ['Mwila', 'Chanda', 'Bwalya', 'Mulenga', 'Natasha', 'Kondwani', 'Thandiwe', 'Musonda', 'Chileshe', 'Lubinda', 'Mutale', 'Namakau', 'Kabwe', 'Mapalo', 'Chipo', 'Luyando', 'Mwape', 'Nalukui', 'Kelvin', 'Precious', 'Bupe', 'Inonge', 'Jacob', 'Ruth', 'Emmanuel', 'Grace', 'Chola', 'Mubanga'];
const LAST = ['Banda', 'Phiri', 'Mwale', 'Zulu', 'Tembo', 'Lungu', 'Mumba', 'Chisenga', 'Sakala', 'Daka', 'Mulenga', 'Kapembwa', 'Sichone', 'Mwansa', 'Nkonde', 'Simwanza', 'Hamoonga', 'Siame', 'Ngoma', 'Kunda', 'Mubita', 'Chirwa'];
const TOWNS = ['Lusaka', 'Kitwe', 'Ndola', 'Kabwe', 'Livingstone', 'Chingola', 'Mufulira', 'Chipata', 'Kasama', 'Solwezi', 'Mazabuka', 'Choma', 'Mongu', 'Mansa'];
const EMPLOYERS = ['Ministry of Health', 'Ministry of Education', 'Zambia Police Service', 'ZESCO', 'Zambia Sugar', 'First Quantum Minerals', 'Konkola Copper Mines', 'Shoprite Zambia', 'Lusaka City Council', 'Self-employed (trader)', 'Self-employed (farmer)', 'Zanaco', 'Airtel Zambia', 'University Teaching Hospital'];
const LENDERS = ['QuickLend Microfinance', 'Kwacha Credit Solutions', 'ZedFunds Money Lenders', 'Lusaka Cash Advance', 'Copperbelt Credit Ltd', 'Bayport Financial Services', 'Madison Finance', 'Izwe Loans'];

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, list: T[]) => list[Math.floor(r() * list.length)];
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const round = (n: number, to: number) => Math.round(n / to) * to;

class SimulatedBureau implements CreditBureau {
  async lookup(nrc: string): Promise<BureauRecord | null> {
    const r = rng(`nrc:${nrc}`);
    if (r() < 0.08) return null;
    const score = Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(SCORE_MIN + ((r() + r() + r()) / 3) * 1.15 * (SCORE_MAX - SCORE_MIN))));
    const q = (score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN);
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
}

export const bureau: CreditBureau = config.BUREAU_DRIVER === 'simulated' ? new SimulatedBureau() : new SimulatedBureau();
export const isGood = (score: number) => score >= GOOD_SCORE;
