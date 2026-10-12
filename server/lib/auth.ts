import crypto from 'node:crypto';
import type { Request } from 'express';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { nowIso, sha256, uuid } from './util.js';
import { unauthorized, forbidden } from './errors.js';
import type { Role } from '../../shared/types.js';
import { ADMIN_ROLES } from '../../shared/types.js';

/* ------------------------- passwords (scrypt, per-user salt) -------------- */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------- sessions (opaque tokens, httpOnly cookie) ------ */

const COOKIE = 'ojas_session';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  first_name: string;
  last_name: string;
  phone: string | null;
  marketing_consent: boolean;
}

export async function createSession(req: Request, res: Response2, userId: string): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = sha256(token);
  const now = Date.now();
  const expires = new Date(now + config.sessionTtlHours * 3600_000).toISOString();
  await db().run(
    `INSERT INTO sessions (id, user_id, user_agent, ip, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, req.headers['user-agent']?.slice(0, 300) ?? null, req.ip ?? null, nowIso(), nowIso(), expires]
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.sessionTtlHours * 3600_000,
    path: '/',
  });
}

// avoid importing express Response type name clash
type Response2 = import('express').Response;

export async function loadSessionUser(req: Request): Promise<SessionUser | null> {
  const token: string | undefined = req.cookies?.[COOKIE];
  if (!token) return null;
  const id = sha256(token);
  const row = await db().get(
    `SELECT s.id AS session_id, s.expires_at, s.revoked_at, u.id, u.email, u.role, u.first_name, u.last_name, u.phone, u.marketing_consent
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    [id]
  );
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  // touch last_seen at most every 5 minutes
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    await db().run(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`, [nowIso(), row.session_id]);
  }
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    marketing_consent: row.marketing_consent === 1,
  };
}

export async function destroySession(req: Request, res: Response2): Promise<void> {
  const token: string | undefined = req.cookies?.[COOKIE];
  if (token) await db().run(`UPDATE sessions SET revoked_at = ? WHERE id = ?`, [nowIso(), sha256(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

/* ------------------------- guards / RBAC ---------------------------------- */

declare global {
  // eslint-disable-next-line no-var
    namespace Express {
      interface Request {
        user?: SessionUser;
      }
    }
  }

export function requireAuth(req: Request): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

const PERMISSIONS: Record<string, Role[]> = {
  'products:write': ['manager', 'owner'],
  'orders:write': ['support', 'manager', 'owner'],
  'customers:read': ['support', 'manager', 'owner'],
  'coupons:write': ['manager', 'owner'],
  'suppliers:write': ['owner'],
  'settings:write': ['owner'],
  'returns:write': ['support', 'manager', 'owner'],
  'content:write': ['manager', 'owner'],
  'reports:read': ['manager', 'owner'],
};

export function isAdminRole(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

export function requirePermission(req: Request, permission: string): SessionUser {
  const user = requireAuth(req);
  if (!isAdminRole(user.role)) throw forbidden();
  const allowed = PERMISSIONS[permission];
  if (allowed && !allowed.includes(user.role)) {
    throw forbidden(`Your role (${user.role}) does not include "${permission}"`);
  }
  return user;
}

export function listPermissionsFor(role: Role): string[] {
  if (!isAdminRole(role)) return [];
  return Object.entries(PERMISSIONS)
    .filter(([, roles]) => roles.includes(role))
    .map(([p]) => p);
}

/* ------------------------- password reset tokens -------------------------- */

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await db().run(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [uuid(), userId, sha256(token), new Date(Date.now() + 3600_000).toISOString(), nowIso()]
  );
  return token;
}

export async function consumePasswordResetToken(token: string): Promise<string> {
  const row = await db().get(`SELECT * FROM password_reset_tokens WHERE token_hash = ?`, [sha256(token)]);
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    throw unauthorized('This reset link is invalid or has expired');
  }
  await db().run(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`, [nowIso(), row.id]);
  return row.user_id;
}
