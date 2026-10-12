import { db } from '../../db/index.js';
import { json } from '../../lib/util.js';
import type { SupplierAdapter } from './types.js';
import { MockSupplierAdapter } from './mock.js';
import { HttpJsonSupplierAdapter } from './http-json.js';

export interface SupplierRow {
  id: string;
  code: string;
  name: string;
  adapter_type: string;
  config_json: string;
  is_active: number;
  supports_fulfillment: number;
  supports_tracking: number;
  notes: string | null;
}

export async function listSuppliers(): Promise<SupplierRow[]> {
  return (await db().query(`SELECT * FROM suppliers ORDER BY name`)) as SupplierRow[];
}

export async function getSupplier(idOrCode: string): Promise<SupplierRow | null> {
  return (
    ((await db().get(`SELECT * FROM suppliers WHERE id = ?`, [idOrCode])) as SupplierRow | undefined) ??
    ((await db().get(`SELECT * FROM suppliers WHERE code = ?`, [idOrCode])) as SupplierRow | undefined) ??
    null
  );
}

export function buildAdapter(row: SupplierRow): SupplierAdapter {
  const config = json<Record<string, any>>(row.config_json, {});
  switch (row.adapter_type) {
    case 'mock':
      return new MockSupplierAdapter(row.id, row.code, config);
    case 'http_json':
      return new HttpJsonSupplierAdapter(row.id, row.code, config);
    default:
      throw new Error(`Unknown supplier adapter type: ${row.adapter_type}`);
  }
}
