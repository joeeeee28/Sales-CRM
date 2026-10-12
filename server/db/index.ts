/**
 * Dialect-agnostic database adapter.
 *
 * - `sqlite`   : embedded runtime (node:sqlite, zero native deps) used for local
 *                development, tests and the bundled demo. Data lives in ./data.
 * - `postgres` : production target (also Supabase). Set DATABASE_URL to enable.
 *
 * SQL is written once using `?` placeholders and ANSI-ish constructs supported
 * by both engines. The postgres adapter rewrites placeholders to $n and
 * normalises Date/boolean values so row shapes are identical per dialect.
 *
 * Booleans are stored as INTEGER 0/1 in BOTH dialects (CHECK-constrained) so
 * that application code sees one consistent representation.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool as PgPool, PoolClient } from 'pg';
import { config } from '../config.js';

export type Row = Record<string, any>;

/** node:sqlite (and pg) cannot bind `undefined`; normalise to NULL once, centrally. */
function bind(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

export interface QueryResult {
  rows: Row[];
  changes: number;
}

export interface Db {
  readonly dialect: 'sqlite' | 'postgres';
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  get(sql: string, params?: unknown[]): Promise<Row | undefined>;
  run(sql: string, params?: unknown[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
  /** Run fn inside a transaction (nesting uses SAVEPOINTs). */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  /** Bind the current request's identity for Postgres RLS (GUC). */
  setRequestIdentity(userId: string | null, role: string | null): Promise<void>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* SQLite adapter                                                      */
/* ------------------------------------------------------------------ */

class SqliteDb implements Db {
  readonly dialect = 'sqlite' as const;
  private db: DatabaseSync;
  private depth = 0;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...(bind(params) as any[])) as Row[];
    return rows;
  }

  async get(sql: string, params: unknown[] = []): Promise<Row | undefined> {
    const stmt = this.db.prepare(sql);
    return stmt.get(...(bind(params) as any[])) as Row | undefined;
  }

  async run(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const stmt = this.db.prepare(sql);
    const res = stmt.run(...(bind(params) as any[]));
    return { rows: [], changes: Number(res.changes) };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    this.depth += 1;
    const begin = this.depth === 1 ? 'BEGIN IMMEDIATE' : `SAVEPOINT sp${this.depth}`;
    const commit = this.depth === 1 ? 'COMMIT' : `RELEASE SAVEPOINT sp${this.depth}`;
    const rollback = this.depth === 1 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT sp${this.depth}`;
    this.db.exec(begin);
    try {
      const out = await fn(this);
      this.db.exec(commit);
      return out;
    } catch (err) {
      try {
        this.db.exec(rollback);
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      this.depth -= 1;
    }
  }

  async setRequestIdentity(): Promise<void> {
    /* RLS not supported by SQLite — the query layer enforces scoping. */
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/* ------------------------------------------------------------------ */
/* Postgres adapter                                                    */
/* ------------------------------------------------------------------ */

const requestClient = new AsyncLocalStorage<PoolClient>();

function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function normalise(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

class PgDb implements Db {
  readonly dialect = 'postgres' as const;
  private pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  private runner() {
    return requestClient.getStore() ?? this.pool;
  }

  async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    const res = await this.runner().query(toPg(sql), bind(params));
    return res.rows.map(normalise);
  }

  async get(sql: string, params: unknown[] = []): Promise<Row | undefined> {
    const rows = await this.query(sql, params);
    return rows[0];
  }

  async run(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const res = await this.runner().query(toPg(sql), bind(params));
    return { rows: res.rows.map(normalise), changes: res.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.runner().query(sql);
  }

  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const existing = requestClient.getStore();
    if (existing) {
      // Nested: savepoint on the same client.
      const depth = (existing as any).__spDepth ?? 0;
      const name = `sp${depth + 1}`;
      (existing as any).__spDepth = depth + 1;
      await existing.query(`SAVEPOINT ${name}`);
      try {
        const out = await fn(this);
        await existing.query(`RELEASE SAVEPOINT ${name}`);
        return out;
      } catch (err) {
        await existing.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {});
        throw err;
      } finally {
        (existing as any).__spDepth = depth;
      }
    }
    const client = await this.pool.connect();
    (client as any).__spDepth = 0;
    await client.query('BEGIN');
    try {
      const out = await requestClient.run(client, () => fn(this));
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async setRequestIdentity(userId: string | null, role: string | null): Promise<void> {
    const client = requestClient.getStore();
    const target = client ?? (await this.pool.connect());
    try {
      await target.query('SELECT set_config($1, $2, false), set_config($3, $4, false)', [
        'app.user_id',
        userId ?? '',
        'app.role',
        role ?? '',
      ]);
    } finally {
      if (!client) (target as PoolClient).release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/* ------------------------------------------------------------------ */

let instance: Db | null = null;

export async function createDb(): Promise<Db> {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
      ssl: config.databaseUrl.includes('localhost') ? undefined : { rejectUnauthorized: false },
    });
    return new PgDb(pool);
  }
  return new SqliteDb(config.sqlitePath);
}

export async function initDb(): Promise<Db> {
  if (!instance) instance = await createDb();
  return instance;
}

export function db(): Db {
  if (!instance) throw new Error('Database not initialised — call initDb() first.');
  return instance;
}

/** Wrap a request handler so Postgres RLS sees the caller identity. */
export function withRequestIdentity<T>(userId: string | null, role: string | null, fn: () => Promise<T>): Promise<T> {
  if (!instance || instance.dialect !== 'postgres') return fn();
  return (instance as PgDb).tx(async () => {
    await instance!.setRequestIdentity(userId, role);
    return fn();
  });
}
