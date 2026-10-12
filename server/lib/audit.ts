import type { Request } from 'express';
import { db } from '../db/index.js';
import { nowIso, uuid } from './util.js';

export interface AuditInput {
  actor?: { id?: string | null; type: string };
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  req?: Request;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db().run(
      `INSERT INTO audit_logs (id, actor_user_id, actor_type, action, entity_type, entity_id, before_json, after_json, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        input.actor?.id ?? null,
        input.actor?.type ?? 'system',
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.before == null ? null : JSON.stringify(input.before),
        input.after == null ? null : JSON.stringify(input.after),
        input.req?.ip ?? null,
        input.req?.headers['user-agent']?.slice(0, 300) ?? null,
        nowIso(),
      ]
    );
  } catch (err) {
    console.error('[audit] failed to write', err);
  }
}
