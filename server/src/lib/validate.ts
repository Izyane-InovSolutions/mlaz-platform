import { z } from 'zod';
import { AppError } from './errors.js';

/** The 400 for invalid input, listing each invalid field. Also used for schema.parse() failures in services (app.ts). */
export function validationFailed(error: z.ZodError) {
  const fields = error.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
  return new AppError(400, 'VALIDATION_FAILED', fields.map(f => (f.field ? `${f.field}: ${f.message}` : f.message)).join('; '), { fields });
}

/** Parses input with a zod schema, turning failures into a 400 that lists each invalid field. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw validationFailed(r.error);
}

export const PROVINCES = ['Central', 'Copperbelt', 'Eastern', 'Luapula', 'Lusaka', 'Muchinga', 'Northern', 'North-Western', 'Southern', 'Western'] as const;

// No control characters in any text field (line breaks and tabs are allowed in free text only).
// eslint-disable-next-line no-control-regex -- matching control characters is the point: they are rejected
const CONTROL =/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const trimmed = (max = 200) => z.string().trim().min(1, 'Required').max(max).refine(v => !CONTROL.test(v), 'Contains characters that are not allowed');
export const s = {
  text: trimmed,
  optionalText: (max = 500) => z.string().trim().max(max).refine(v => !CONTROL.test(v), 'Contains characters that are not allowed').optional().default(''),
  /** A single line: no line breaks either (names, references, anything that may end up in an email header). */
  line: (max = 200) => trimmed(max).refine(v => !/[\r\n]/.test(v), 'Must be a single line'),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{9,20}$/, 'Enter a valid phone number'),
  // eslint-disable-next-line security/detect-unsafe-regex -- anchored, no nested quantifiers, input already trimmed: linear time
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
