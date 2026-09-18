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
  'brand',
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
  'department',
  'department_question',
  'session',
  'apply_submission',
  'honeypot_rejection',
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

  const { rows: brandCols } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'brand_id'
        AND table_name IN ('campaign', 'department', 'question')`
  );
  if (brandCols.length < 3) {
    throw new Error('[verify] brand_id is required on campaign, department and question');
  }

  const { rows: questionBrandUnique } = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'question_brand_text_unique'`
  );
  if (questionBrandUnique.length === 0) {
    throw new Error('[verify] question unique (brand_id, text) constraint is missing');
  }

  const { rows: sameBrand } = await pool.query(
    `SELECT 1 FROM pg_trigger WHERE tgname = 'campaign_department_same_brand' AND NOT tgisinternal`
  );
  if (sameBrand.length === 0) {
    throw new Error('[verify] campaign_department_same_brand trigger is missing');
  }

  const { rows: nameKey } = await pool.query(
    `SELECT 1 FROM pg_proc WHERE proname = 'department_name_key'`
  );
  if (nameKey.length === 0) {
    throw new Error('[verify] department_name_key is missing');
  }

  const { rows: normUnique } = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = 'department_brand_norm_name_active_unique'`
  );
  if (normUnique.length === 0) {
    throw new Error('[verify] department normalised-name unique index is missing');
  }

  const { rows: appCampaignStage } = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_application_campaign_stage'`
  );
  if (appCampaignStage.length === 0) {
    throw new Error('[verify] idx_application_campaign_stage is missing');
  }

  const { rows: entryChannel } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'application' AND column_name = 'entry_channel'`
  );
  if (entryChannel.length === 0) {
    throw new Error('[verify] application.entry_channel is missing (M4.5)');
  }

  console.log(
    `[verify] schema ok: ${EXPECTED_TABLES.length} tables, event append-only trigger present, person.phone unique, campaign_question unique, brand_id on campaign, department and question`
  );
}
