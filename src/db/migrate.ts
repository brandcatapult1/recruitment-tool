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
 * - Everything happens inside ONE transaction, so a failure leaves the
 *   database exactly as it was and startup aborts rather than serving a
 *   half-migrated schema.
 * - The transaction takes a transaction-scoped advisory lock first, which
 *   serialises concurrent booting instances (old and new instances overlap
 *   during a Render deploy). It must be pg_advisory_xact_lock, not
 *   pg_advisory_lock: PRD §13.3 mandates Neon's *pooled* connection string,
 *   which is PgBouncer in transaction mode, and session-scoped locks are not
 *   reliable there. A transaction-scoped lock is held on the pinned server
 *   connection and released on commit.
 * - Migration files are written to be idempotent, so a schema that already
 *   exists (e.g. created by hand in the Neon SQL editor before this runner
 *   existed) is adopted and recorded rather than colliding.
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
    await client.query('BEGIN');
    console.log('[migrate] waiting for migration lock...');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
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
      console.log(`[migrate] apply ${file}`);
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      ran += 1;
    }

    await client.query('COMMIT');
    console.log(
      `[migrate] done: ${ran} applied, ${applied.size} previously applied, ${files.length} total`
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[migrate] FAILED — rolled back, database unchanged');
    throw err;
  } finally {
    client.release();
  }
}
