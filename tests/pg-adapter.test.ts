/**
 * Postgres adapter unit tests with a mocked `pg` driver — verifies the dialect
 * translation layer WITHOUT a database server: ? → $n rewriting, undefined→NULL
 * binds, int8/numeric type parsers, Date normalisation, pool hardening options,
 * transaction lifecycle and tx-local RLS identity.
 * (tests/postgres.test.ts covers the real-server path when TEST_DATABASE_URL is set.)
 */
import { describe, expect, it, vi } from 'vitest';

const queries: { sql: string; params?: unknown[] }[] = [];
const parsers = new Map<number, (v: string) => unknown>();
const g = globalThis as any;

vi.mock('pg', () => {
  class FakePool {
    constructor(opts: any) {
      g.__poolOpts = opts;
    }
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT * FROM dated')) return { rows: [{ ts: new Date('2026-01-01T00:00:00Z') }], rowCount: 1 };
      return { rows: [{ ok: 1 }], rowCount: 1 };
    }
    async connect() {
      const self = this;
      return { query: (s: string, p?: unknown[]) => self.query(s, p), release() {} };
    }
    on() {}
    async end() {}
  }
  return {
    default: {
      Pool: FakePool,
      types: { setTypeParser: (oid: number, fn: any) => parsers.set(oid, fn) },
    },
  };
});

process.env.DATABASE_URL = 'postgres://app:secret@db.example.com:5432/postgres';
process.env.SESSION_SECRET = 'test-secret-value-long-enough';

describe('postgres adapter (mocked driver)', () => {
  it('rewrites placeholders, binds undefined as NULL, and configures a hardened pool', async () => {
    const { createDb } = await import('../server/db/index.js');
    const db = await createDb();
    expect(db.dialect).toBe('postgres');

    await db.query('SELECT * FROM t WHERE a = ? AND b = ? AND c = ?', [1, undefined, 'x']);
    expect(queries[0]?.sql).toBe('SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $3');
    expect(queries[0]?.params).toEqual([1, null, 'x']);

    expect(g.__poolOpts.ssl).toBeTruthy(); // non-localhost → SSL required
    expect(g.__poolOpts.ssl.rejectUnauthorized).toBe(false);
    expect(g.__poolOpts.max).toBe(5); // PG_POOL_MAX default
    expect(g.__poolOpts.connectionTimeoutMillis).toBe(10_000);
    expect(g.__poolOpts.idleTimeoutMillis).toBe(60_000);
  });

  it('registers int8/numeric parsers so aggregates are numbers like sqlite', async () => {
    await import('../server/db/index.js');
    const { createDb } = await import('../server/db/index.js');
    await createDb();
    expect(parsers.get(20)?.('42')).toBe(42); // COUNT/SUM(bigint)
    expect(parsers.get(1700)?.('12.5')).toBe(12.5); // AVG/numeric
    expect(parsers.get(20)?.(null as any)).toBeNull();
  });

  it('normalises Date values to ISO strings', async () => {
    const { createDb } = await import('../server/db/index.js');
    const db = await createDb();
    const rows = await db.query('SELECT * FROM dated');
    expect(rows[0]?.ts).toBe('2026-01-01T00:00:00.000Z');
  });

  it('runs transactions with BEGIN/COMMIT and ROLLBACK on error', async () => {
    const { createDb } = await import('../server/db/index.js');
    const db = await createDb();
    queries.length = 0;
    await db.tx(async () => {
      await db.run('UPDATE x SET y = ? WHERE id = ?', [2, 'a']);
    });
    const sqls = queries.map((q) => q.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls).toContain('UPDATE x SET y = $1 WHERE id = $2');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');

    queries.length = 0;
    await expect(
      db.tx(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(queries.map((q) => q.sql)).toContain('ROLLBACK');
  });

  it('pushes RLS identity as TRANSACTION-LOCAL settings (pooler safe)', async () => {
    const { createDb } = await import('../server/db/index.js');
    const db = await createDb();
    queries.length = 0;
    await db.setRequestIdentity('user-9', 'owner');
    const q = queries[0];
    expect(q?.sql).toContain('set_config');
    expect(q?.sql).toContain('true), set_config'); // is_local = true
    expect(q?.params).toEqual(['app.user_id', 'user-9', 'app.role', 'owner']);
  });
});
