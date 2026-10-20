import { z } from 'zod';
import { AppError } from './errors.js';

/** Parses input with a zod schema, turning failures into a 400 that lists each invalid field. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields = r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
  throw new AppError(400, 'VALIDATION_FAILED', fields.map(f => (f.field ? `${f.field}: ${f.message}` : f.message)).join('; '), { fields });
}

export const PROVINCES = ['Central', 'Copperbelt', 'Eastern', 'Luapula', 'Lusaka', 'Muchinga', 'Northern', 'North-Western', 'Southern', 'Western'] as const;

const trimmed = (max = 200) => z.string().trim().min(1, 'Required').max(max);
export const s = {
  text: trimmed,
  optionalText: (max = 500) => z.string().trim().max(max).optional().default(''),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{9,20}$/, 'Enter a valid phone number'),
  msisdn: z.string().trim().transform(v => v.replace(/[\s()-]/g, '')).pipe(z.string().regex(/^(\+?260|0)?[79][5-7][0-9]{7}$/, 'Enter a valid Zambian mobile money number')),
  tpin: z.string().trim().regex(/^\d{10}$/, 'TPIN must be 10 digits'),
  pacra: z.string().trim().regex(/^\d{12}$/, 'PACRA number must be 12 digits'),
  nrc: z.string().trim().regex(/^\d{6}\/\d{2}\/\d$/, 'NRC must look like 284512/11/1'),
  province: z.enum(PROVINCES),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  money: z.coerce.number().nonnegative().max(10_000_000).transform(n => Math.round(n * 100) / 100),
  page: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  }),
};

export const paged = <T>(items: T[], total: number, page: number, pageSize: number) => ({ items, total, page, pageSize });
