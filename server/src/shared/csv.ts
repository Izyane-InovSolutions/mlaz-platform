export interface Table { cols: string[]; rows: (string | number)[][] }

/** CSV with a byte-order mark so Excel opens it with the right encoding. */
export function toCsv(t: Table) {
  const cell = (v: string | number) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  return '﻿' + [t.cols, ...t.rows].map(r => r.map(cell).join(',')).join('\r\n');
}
