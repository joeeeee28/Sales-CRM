import fs from 'node:fs';
import path from 'node:path';
import { db, type Db } from './index.js';

export async function migrate(target: Db = db()): Promise<string[]> {
  const dialect = target.dialect;
  const dir = path.resolve(process.cwd(), 'migrations', dialect);
  await target.run(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
  );
  const applied = new Set(
    (await target.query(`SELECT version FROM schema_migrations`)).map((r) => String(r.version))
  );
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const done: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await target.tx(async (txDb) => {
      await txDb.exec(sql);
      await txDb.run(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, [
        version,
        new Date().toISOString(),
      ]);
    });
    done.push(version);
  }
  return done;
}
