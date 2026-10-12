import { config } from '../config.js';
import { processFulfillmentQueue, syncTracking } from './fulfillment.js';
import { runAllSyncs } from './sync.js';
import { sweepAbandonedCarts } from './abandoned-carts.js';

let timer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  if (!config.suppliers.schedulerEnabled || timer) return;
  console.log(`[scheduler] supplier jobs every ${config.suppliers.schedulerIntervalMs / 1000}s`);
  const tick = async () => {
    try {
      await processFulfillmentQueue();
      await syncTracking();
      await runAllSyncs();
      await sweepAbandonedCarts();
    } catch (err) {
      console.warn('[scheduler] tick failed:', err instanceof Error ? err.message : err);
    }
  };
  timer = setInterval(tick, config.suppliers.schedulerIntervalMs);
  timer.unref();
  setTimeout(tick, 5_000).unref();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
