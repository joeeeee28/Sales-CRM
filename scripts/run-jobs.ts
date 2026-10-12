import { initDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { processFulfillmentQueue, syncTracking } from '../server/jobs/fulfillment.js';
import { runAllSyncs } from '../server/jobs/sync.js';
import { sweepAbandonedCarts } from '../server/jobs/abandoned-carts.js';

const db = await initDb();
await migrate(db);
console.log('[jobs] fulfillment:', await processFulfillmentQueue());
console.log('[jobs] tracking:', await syncTracking());
await runAllSyncs();
console.log('[jobs] abandoned carts:', await sweepAbandonedCarts());
await db.close();
