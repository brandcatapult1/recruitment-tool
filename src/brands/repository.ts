import { pool } from '../db/pool';
import { UserFacingError } from '../http/errors';

export interface BrandRow {
  brand_id: string;
  name: string;
  logo_public_id: string | null;
  apply_page_title: string;
  active: boolean;
}

export async function listBrands(includeInactive = true): Promise<BrandRow[]> {
  const { rows } = await pool.query<BrandRow>(
    `SELECT * FROM brand ${includeInactive ? '' : 'WHERE active = true'}
      ORDER BY active DESC, name ASC`
  );
  return rows;
}

export async function getBrand(brandId: string): Promise<BrandRow | null> {
  const { rows } = await pool.query<BrandRow>('SELECT * FROM brand WHERE brand_id = $1', [brandId]);
  return rows[0] ?? null;
}

export interface BrandInput {
  name: string;
  applyPageTitle: string;
  logoPublicId?: string | null;
}

export async function createBrand(input: BrandInput): Promise<BrandRow> {
  validate(input);
  try {
    const { rows } = await pool.query<BrandRow>(
      `INSERT INTO brand (name, apply_page_title, logo_public_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [input.name, input.applyPageTitle, input.logoPublicId ?? null]
    );
    return rows[0];
  } catch (err) {
    throw uniqueOr(err, 'A brand with that name already exists.');
  }
}

export async function updateBrand(brandId: string, input: BrandInput): Promise<BrandRow | null> {
  validate(input);
  try {
    const { rows } = await pool.query<BrandRow>(
      `UPDATE brand
          SET name = $2, apply_page_title = $3, logo_public_id = COALESCE($4, logo_public_id)
        WHERE brand_id = $1 RETURNING *`,
      [brandId, input.name, input.applyPageTitle, input.logoPublicId ?? null]
    );
    return rows[0] ?? null;
  } catch (err) {
    throw uniqueOr(err, 'A brand with that name already exists.');
  }
}

export async function setBrandActive(brandId: string, active: boolean): Promise<BrandRow | null> {
  const { rows } = await pool.query<BrandRow>(
    'UPDATE brand SET active = $2 WHERE brand_id = $1 RETURNING *',
    [brandId, active]
  );
  return rows[0] ?? null;
}

function validate(input: BrandInput): void {
  if (!input.name.trim()) throw new UserFacingError('Brand name is required.');
  if (!input.applyPageTitle.trim()) throw new UserFacingError('Apply-page title is required.');
}

function uniqueOr(err: unknown, message: string): Error {
  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
    return new UserFacingError(message);
  }
  return err instanceof Error ? err : new Error(String(err));
}
