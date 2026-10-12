import type { Request } from 'express';
import { z } from 'zod';
import { HttpError, badRequest } from './errors.js';

export function validate<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw new HttpError(400, 'validation_error', details[0]?.message ?? 'Invalid input', details);
  }
  return result.data;
}

export const addressSchema = z.object({
  label: z.string().max(40).optional().default('Home'),
  full_name: z.string().min(2).max(120),
  phone: z.string().min(8).max(20),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional().nullable(),
  city: z.string().min(2).max(100),
  state: z.string().min(2).max(100),
  postal_code: z.string().min(4).max(12),
  country: z.string().min(2).max(2).default('IN'),
  is_default_shipping: z.boolean().optional().default(false),
});

export function clientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
}

export { badRequest };
