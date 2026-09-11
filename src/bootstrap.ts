import { pool } from './db/pool';
import { hashPassword } from './auth/passwords';

/**
 * Startup admin bootstrap. Runs on every boot, after migrations.
 *
 * If at least one active admin exists, this does nothing. Otherwise it
 * creates one from ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD environment
 * variables (set in the host's dashboard alongside the §13.5 keys).
 *
 * Idempotent by construction: once the admin exists, every later boot takes
 * the "do nothing" path. If the ADMIN_EMAIL already belongs to a staff row
 * (e.g. an admin that was deactivated by hand), nothing is created or
 * modified — that situation is logged and left for a human to resolve.
 */
export async function ensureAdminExists(): Promise<void> {
  const admins = await pool.query(
    "SELECT 1 FROM staff WHERE system_role = 'admin' AND active = true LIMIT 1"
  );
  if (admins.rows.length > 0) {
    console.log('[bootstrap] active admin exists; nothing to do');
    return;
  }

  const name = process.env.ADMIN_NAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!name || !email || !password) {
    console.warn(
      '[bootstrap] no active admin exists and ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD are not all set — no one can log in until they are'
    );
    return;
  }

  const existing = await pool.query('SELECT staff_id FROM staff WHERE lower(email) = lower($1)', [
    email,
  ]);
  if (existing.rows.length > 0) {
    console.warn(
      `[bootstrap] no active admin exists, but a staff row already uses ${email} — not touching it; resolve manually`
    );
    return;
  }

  const hash = await hashPassword(password);
  await pool.query(
    `INSERT INTO staff (name, department, system_role, email, password_hash)
     VALUES ($1, 'Talent Acquisition', 'admin', $2, $3)`,
    [name, email, hash]
  );
  console.log(`[bootstrap] created admin ${name} <${email}>`);
}
