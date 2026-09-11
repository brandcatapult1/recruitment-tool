import fs from 'fs';
import path from 'path';
import { pool } from './pool';

/**
 * Forward-only migration runner, executed automatically on every server
 * start (there is no terminal in this deployment model — Render builds from
 * GitHub and boots the app; startup is the only place migrations can run).
 *
 * Safe on every boot:
 * - Applied files are recorded in _migrations and skipped on later boots.
 * - Each migration runs in its own transaction; a failure rolls back and
 *   aborts startup so a broken schema change never serves traffic.
 * - A Postgres advisory lock serialises concurrent booting instances (e.g.
 *   old and new instances overlapping during a deploy), so a migration can
 *   never run twice.
 *
 * Per PRD §13.2, deploy to the dev environment (Neon `dev` branch) before
 * main, always.
 */

const MIGRATION_LOCK_KEY = 72099001;

export async function runMigrations(): Promise<void> {
  const dir = path.resolve(process.cwd(), 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    console.log('[migrate] waiting for migration lock...');
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    console.log('[migrate] lock acquired');

    await client.query(
      'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM _migrations');
    const applied = new Set(rows.map((r) => r.name));

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] skip  ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      console.log(`[migrate] apply ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrate] FAILED ${file} — rolled back`);
        throw err;
      }
    }
    console.log(
      `[migrate] done: ${ran} applied, ${applied.size} previously applied, ${files.length} total`
    );
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
