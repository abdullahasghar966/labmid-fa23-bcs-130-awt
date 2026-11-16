// Drops everything and re-creates the schema + seed data.
//   npm run db:reset            (schema + seed)
//   npm run db:reset -- --no-seed
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';

const dbDir = fileURLToPath(new URL('../../database/', import.meta.url));

export async function resetDatabase({ seed = true, connectionString = config.databaseUrl } = {}) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await client.query(readFileSync(`${dbDir}schema.sql`, 'utf8'));
    if (seed) await client.query(readFileSync(`${dbDir}seed.sql`, 'utf8'));
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const seed = !process.argv.includes('--no-seed');
  resetDatabase({ seed })
    .then(() => console.log(`Database reset${seed ? ' and seeded' : ''}.`))
    .catch((err) => {
      console.error('Reset failed:', err.message);
      process.exit(1);
    });
}
