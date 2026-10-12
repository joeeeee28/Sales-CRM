import 'dotenv/config';
import path from 'node:path';
import crypto from 'node:crypto';

function str(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v);
}

function int(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const nodeEnv = str('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';

const sessionSecret = str('SESSION_SECRET', '');
if (isProd && sessionSecret.length < 16) {
  // Fail loud rather than silently shipping an insecure default.
  throw new Error('SESSION_SECRET must be set (>=16 chars) in production. See .env.example.');
}

export const config = {
  env: nodeEnv,
  isProd,
  port: int('PORT', 4000),
  publicUrl: str('PUBLIC_URL', `http://localhost:${int('PORT', 4000)}`).replace(/\/$/, ''),
  databaseUrl: str('DATABASE_URL'),
  sqlitePath: str('SQLITE_PATH', './data/app.sqlite'),
  sessionSecret: sessionSecret || 'dev-only-insecure-session-secret',
  sessionTtlHours: int('SESSION_TTL_HOURS', 720),
  adminEmail: str('ADMIN_EMAIL', 'owner@example.com'),
  adminPassword: str('ADMIN_PASSWORD', 'ChangeMe123!'),
  currency: str('STORE_CURRENCY', 'INR'),
  payments: {
    razorpayKeyId: str('RAZORPAY_KEY_ID'),
    razorpayKeySecret: str('RAZORPAY_KEY_SECRET'),
    razorpayWebhookSecret: str('RAZORPAY_WEBHOOK_SECRET'),
    get razorpayLive() {
      return Boolean(this.razorpayKeyId && this.razorpayKeySecret);
    },
  },
  email: {
    provider: str('EMAIL_PROVIDER', 'console') as 'console' | 'resend',
    from: str('EMAIL_FROM', 'Ojas Store <orders@example.com>'),
    resendKey: str('RESEND_API_KEY'),
  },
  suppliers: {
    schedulerEnabled: bool('SUPPLIER_SCHEDULER_ENABLED', !isProd),
    schedulerIntervalMs: int('SUPPLIER_SCHEDULER_INTERVAL_MS', 60_000),
  },
  analytics: {
    ga4: str('VITE_GA4_MEASUREMENT_ID'),
    metaPixel: str('VITE_META_PIXEL_ID'),
  },
  seedSampleData: bool('SEED_SAMPLE_DATA', true),
  version: str('APP_VERSION', '1.0.0'),
  instanceId: crypto.randomUUID(),
};

export type AppConfig = typeof config;

export const paths = {
  root: path.resolve(process.cwd()),
  migrations: (dialect: 'sqlite' | 'postgres') => path.resolve(process.cwd(), 'migrations', dialect),
  publicDir: path.resolve(process.cwd(), 'dist', 'public'),
  mediaDir: path.resolve(process.cwd(), 'public', 'media'),
};
