import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';

if (config.databaseUrl) {
  console.error('Refusing to reset: DATABASE_URL points at a real database. Drop it manually if you truly intend this.');
  process.exit(1);
}
const file = path.resolve(config.sqlitePath);
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  if (fs.existsSync(file + suffix)) fs.rmSync(file + suffix);
}
console.log('[reset] sqlite database removed — run `npm run db:seed` (or start the server) to recreate.');
