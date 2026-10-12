import type { Request, Response, NextFunction } from 'express';
import { tooMany } from './errors.js';

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();

/**
 * In-process token-bucket rate limiter for sensitive endpoints.
 * Single-instance by design; swap for a shared store (Redis) when scaling out.
 */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const { windowMs, max } = opts;
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${opts.key?.(req) ?? req.ip ?? 'anon'}:${req.path}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.updated > windowMs) {
      bucket = { tokens: max, updated: now };
      buckets.set(key, bucket);
    }
    // refill proportionally to elapsed time
    const refill = ((now - bucket.updated) / windowMs) * max;
    bucket.tokens = Math.min(max, bucket.tokens + refill);
    bucket.updated = now;
    if (bucket.tokens < 1) {
      next(tooMany());
      return;
    }
    bucket.tokens -= 1;
    next();
  };
}

export const authLimiter = rateLimit({ windowMs: 60_000, max: 10 });
export const checkoutLimiter = rateLimit({ windowMs: 60_000, max: 20 });
export const contactLimiter = rateLimit({ windowMs: 60_000, max: 5 });
export const trackingLimiter = rateLimit({ windowMs: 60_000, max: 20 });

// periodic sweep so the map cannot grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now - v.updated > 10 * 60_000) buckets.delete(k);
}, 5 * 60_000).unref();
