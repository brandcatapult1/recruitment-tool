import { pool } from './db/pool';
import { hashPassword, verifyPassword } from './auth/passwords';

/**
 * Startup admin bootstrap. Runs on every boot, after migrations.
 *
 * This deployment has no terminal: environment variables in the host's
 * dashboard are the only way to administer the first login. So ADMIN_EMAIL
 * plus ADMIN_PASSWORD are treated as the source of truth for that one
 * account:
 *
 * - No active admin exists  -> create one from ADMIN_NAME/EMAIL/PASSWORD.
 * - Admin exists, password matches ADMIN_PASSWORD -> do nothing.
 * - Admin exists, password differs -> reset it to ADMIN_PASSWORD and log it.
 *   (Editing the env var and redeploying is the password reset mechanism.)
 * - ADMIN_PASSWORD not set -> never touches an existing password.
 *
 * Every path is idempotent and safe to run on every boot. If a password
 * change UI is ever added, remove ADMIN_PASSWORD from the host so the stored
 * password stops being overwritten on deploy.
 */
export async function ensureAdminExists(): Promise<void> {
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;

  const { rows: admins } = await pool.query<{ email: string | null; password_hash: string | null }>(
    "SELECT email, password_hash FROM staff WHERE system_role = 'admin' AND active = true"
  );

  if (admins.length === 0) {
    if (!name || !email || !password) {
      console.warn(
        '[bootstrap] no active admin exists and ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD are not all set — no one can log in until they are'
      );
      return;
    }
    const taken = await pool.query('SELECT staff_id FROM staff WHERE lower(email) = lower($1)', [
      email,
    ]);
    if (taken.rows.length > 0) {
      console.warn(
        `[bootstrap] no active admin exists, but a staff row already uses ${email} — not touching it; resolve manually`
      );
      return;
    }
    await pool.query(
      `INSERT INTO staff (name, department, system_role, email, password_hash)
       VALUES ($1, 'Talent Acquisition', 'admin', $2, $3)`,
      [name, email, await hashPassword(password)]
    );
    console.log(`[bootstrap] created admin ${name} <${email}>`);
    return;
  }

  console.log(
    `[bootstrap] active admin(s) present: ${admins.map((a) => a.email ?? '(no email)').join(', ')}`
  );

  if (!email || !password) {
    console.log('[bootstrap] ADMIN_EMAIL/ADMIN_PASSWORD not both set; leaving passwords unchanged');
    return;
  }

  const target = admins.find((a) => a.email?.toLowerCase() === email.toLowerCase());
  if (!target) {
    console.warn(
      `[bootstrap] ADMIN_EMAIL ${email} does not match any active admin — check for a typo; existing admins are unchanged`
    );
    return;
  }

  const matches = target.password_hash
    ? await verifyPassword(password, target.password_hash)
    : false;
  if (matches) {
    console.log(`[bootstrap] admin ${email} password already matches ADMIN_PASSWORD`);
    return;
  }

  await pool.query('UPDATE staff SET password_hash = $2 WHERE lower(email) = lower($1)', [
    email,
    await hashPassword(password),
  ]);
  console.log(`[bootstrap] admin ${email} password reset to the current ADMIN_PASSWORD`);
}
