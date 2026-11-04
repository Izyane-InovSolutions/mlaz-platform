// Calendar dates (membership validity, MoF expiry, event dates) are stored as Postgres DATE and handled here as
// UTC-midnight Date objects. "Today" is taken in Zambian time so a day rolls over at midnight in Lusaka.

const TZ = 'Africa/Lusaka';
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const todayIso = () => ymd.format(new Date());
export const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const today = () => dateOnly(todayIso());
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
export function addYears(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCFullYear(x.getUTCFullYear() + n);
  return x;
}
export const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 864e5);

/** Current hour in Lusaka, used to schedule the nightly job. */
export const lusakaHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

export const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtDateTime = (d: Date | string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ });
