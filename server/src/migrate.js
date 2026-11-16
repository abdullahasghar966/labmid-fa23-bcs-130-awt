import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';
import { query } from './db.js';

// On a fresh database (e.g. a new hosted one) create the tables and sample data.
export async function ensureSchema() {
  const { rows } = await query("SELECT to_regclass('public.equipment') AS t");
  if (rows[0].t) return false;
  const sql = (file) => readFileSync(path.join(ROOT_DIR, 'database', file), 'utf8');
  await query(sql('schema.sql'));
  await query(sql('seed.sql'));
  console.log('Empty database: created tables and sample equipment.');
  return true;
}
