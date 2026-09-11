import { pool } from './pool';

/**
 * Post-migration schema check, run on every boot after runMigrations().
 *
 * Migrations are idempotent, so a schema created outside this runner (for
 * example pasted into the Neon SQL editor by hand) gets adopted rather than
 * rejected. That adoption is only safe if we then confirm the schema is
 * actually complete — this check is that confirmation. It fails startup
 * loudly rather than letting the app serve traffic against a half-built
 * database.
 */

const EXPECTED_TABLES = [
  // The eight entities of PRD §5
  'person',
  'campaign',
  'campaign_question',
  'application',
  'screen',
  'round',
  'staff',
  'event',
  // Supporting tables
  'question',
  'session',
  '_migrations',
];

export async function verifySchema(): Promise<void> {
  const { rows: tableRows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  const present = new Set(tableRows.map((r) => r.table_name));
  const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
  if (missing.length > 0) {
    throw new Error(`[verify] schema incomplete — missing tables: ${missing.join(', ')}`);
  }

  // The event log is append-only in the database, not merely by convention (§5.8).
  const { rows: triggerRows } = await pool.query(
    `SELECT 1 FROM pg_trigger WHERE tgname = 'event_append_only' AND NOT tgisinternal`
  );
  if (triggerRows.length === 0) {
    throw new Error('[verify] event append-only trigger is missing');
  }

  // person.phone is the primary dedupe key and must be unique (§5.1).
  const { rows: uniqueRows } = await pool.query(
    `SELECT 1
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
      WHERE t.relname = 'person' AND c.contype = 'u' AND a.attname = 'phone'`
  );
  if (uniqueRows.length === 0) {
    throw new Error('[verify] unique constraint on person.phone is missing');
  }

  const { rows: cqUnique } = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'campaign_question_unique_pair'`
  );
  if (cqUnique.length === 0) {
    throw new Error('[verify] campaign_question unique pair constraint is missing');
  }

  console.log(
    `[verify] schema ok: ${EXPECTED_TABLES.length} tables, event append-only trigger present, person.phone unique, campaign_question unique`
  );
}
