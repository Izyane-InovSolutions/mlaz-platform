import { describe, expect, it } from 'vitest';
import { s } from '../src/lib/validate.js';
import { submitSchema } from '../src/services/applications.js';

describe('name fields', () => {
  it('accept real business and person names', () => {
    for (const v of ["O'Brien & Sons (Pvt) Ltd", 'Mwila "Quick" Loans', 'Chanda-Banda; Lusaka']) expect(s.name().safeParse(v).success).toBe(true);
  });

  it('reject markup and line breaks', () => {
    for (const v of [`Evil');window.__pwned=1;//<img src=x onerror=window.__pwned2=1>"x`, '<b>Bold</b>', 'Two\nlines']) expect(s.name().safeParse(v).success).toBe(false);
  });

  it('guard the application form', () => {
    for (const field of ['name', 'town', 'contact', 'position', 'director'] as const) {
      expect(submitSchema.shape[field].safeParse('<img src=x>').success).toBe(false);
    }
  });
});
