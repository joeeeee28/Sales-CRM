import { initDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';

const db = await initDb();
const applied = await migrate(db);
console.log(applied.length ? `[migrate] applied: ${applied.join(', ')}` : '[migrate] up to date');
await db.close();
