import { config } from './config.js';
import { initDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { startScheduler } from './jobs/scheduler.js';
import { seedIfEmpty } from '../scripts/seed.js';

async function main() {
  const db = await initDb();
  const applied = await migrate(db);
  if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);
  await seedIfEmpty();

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`\n  ${config.publicUrl}`);
    console.log(`  API      http://localhost:${config.port}/api/health`);
    console.log(`  Admin    http://localhost:${config.port}/admin`);
    console.log(`  DB       ${config.databaseUrl ? 'postgres' : `sqlite (${config.sqlitePath})`}`);
    console.log(`  Payments ${config.payments.razorpayLive ? 'RAZORPAY LIVE' : 'simulated (no credentials configured)'}\n`);
  });

  startScheduler();

  const shutdown = async (signal: string) => {
    console.log(`\n[server] ${signal} — shutting down`);
    server.close();
    await db.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
