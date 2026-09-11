import { pool } from '../db/pool';
import { SYSTEM_ROLES, type SystemRole } from '../constants';

export interface StaffRow {
  staff_id: string;
  name: string;
  department: string | null;
  system_role: SystemRole;
  email: string | null;
  password_hash: string | null;
  active: boolean;
}

export async function listStaff(): Promise<StaffRow[]> {
  const { rows } = await pool.query<StaffRow>(
    'SELECT * FROM staff ORDER BY active DESC, name ASC'
  );
  return rows;
}

export async function getStaff(staffId: string): Promise<StaffRow | null> {
  const { rows } = await pool.query<StaffRow>('SELECT * FROM staff WHERE staff_id = $1', [staffId]);
  return rows[0] ?? null;
}

export async function getStaffByEmail(email: string): Promise<StaffRow | null> {
  const { rows } = await pool.query<StaffRow>('SELECT * FROM staff WHERE lower(email) = lower($1)', [
    email,
  ]);
  return rows[0] ?? null;
}

export interface StaffInput {
  name: string;
  department: string | null;
  systemRole: SystemRole;
  email: string | null;
  passwordHash: string | null;
}

export async function createStaff(input: StaffInput): Promise<StaffRow> {
  assertRole(input.systemRole);
  const { rows } = await pool.query<StaffRow>(
    `INSERT INTO staff (name, department, system_role, email, password_hash)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.name, input.department, input.systemRole, input.email, input.passwordHash]
  );
  return rows[0];
}

export async function updateStaff(
  staffId: string,
  input: Omit<StaffInput, 'passwordHash'> & { passwordHash?: string | null }
): Promise<StaffRow | null> {
  assertRole(input.systemRole);
  const { rows } = await pool.query<StaffRow>(
    `UPDATE staff
     SET name = $2, department = $3, system_role = $4, email = $5,
         password_hash = COALESCE($6, password_hash)
     WHERE staff_id = $1 RETURNING *`,
    [staffId, input.name, input.department, input.systemRole, input.email, input.passwordHash ?? null]
  );
  return rows[0] ?? null;
}

/**
 * Deactivation, never deletion (§5.7): the row stays so historical rounds,
 * screens and events keep their attribution. Deactivated staff simply stop
 * appearing in selection dropdowns (see listSelectableInterviewers).
 */
export async function setStaffActive(staffId: string, active: boolean): Promise<StaffRow | null> {
  const { rows } = await pool.query<StaffRow>(
    'UPDATE staff SET active = $2 WHERE staff_id = $1 RETURNING *',
    [staffId, active]
  );
  return rows[0] ?? null;
}

/**
 * The interviewer dropdown source (M6 consumes this). Active staff only —
 * deactivating a staff member removes them from dropdowns while historical
 * records continue to reference them by staff_id (M0 acceptance criterion).
 */
export async function listSelectableInterviewers(): Promise<Pick<StaffRow, 'staff_id' | 'name' | 'department'>[]> {
  const { rows } = await pool.query<StaffRow>(
    'SELECT staff_id, name, department FROM staff WHERE active = true ORDER BY name ASC'
  );
  return rows;
}

function assertRole(role: string): asserts role is SystemRole {
  if (!(SYSTEM_ROLES as readonly string[]).includes(role)) {
    throw new Error(`Unknown system role: ${role}`);
  }
}
