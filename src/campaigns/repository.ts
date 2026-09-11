import { pool } from '../db/pool';
import { CAMPAIGN_STATUSES, type CampaignStatus } from '../constants';

/**
 * Campaigns — a role opening (§5.2) plus its question set (§5.3).
 *
 * Screening qualifiers and feedback dimensions are stored on the campaign
 * row. Recorded screens and rounds snapshot those labels at answer time
 * (R5, src/snapshots.ts), so editing them here cannot relabel past data.
 *
 * There is no delete. Closing a campaign sets status = closed (R3).
 */

export interface CampaignRow {
  campaign_id: string;
  role_title: string;
  department: string;
  positions_open: number;
  salary_band_min: number | null;
  salary_band_max: number | null;
  status: CampaignStatus;
  opened_date: string | null;
  closed_date: string | null;
  public_slug: string;
  screening_qualifiers: string[] | null;
  feedback_dimensions: string[] | null;
  assignment_stage_enabled: boolean;
}

export interface CampaignQuestionRow {
  campaign_question_id: string;
  campaign_id: string;
  question_id: string;
  display_order: number;
  is_required: boolean;
  is_knockout: boolean;
  text: string;
  type: string;
  options: string[] | null;
  active: boolean;
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  const { rows } = await pool.query<CampaignRow>(
    `SELECT * FROM campaign
      ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END,
               opened_date DESC NULLS LAST,
               role_title ASC`
  );
  return rows;
}

export async function getCampaign(campaignId: string): Promise<CampaignRow | null> {
  const { rows } = await pool.query<CampaignRow>(
    'SELECT * FROM campaign WHERE campaign_id = $1',
    [campaignId]
  );
  return rows[0] ?? null;
}

export async function getCampaignBySlug(slug: string): Promise<CampaignRow | null> {
  const { rows } = await pool.query<CampaignRow>(
    'SELECT * FROM campaign WHERE public_slug = $1',
    [slug]
  );
  return rows[0] ?? null;
}

export interface CampaignInput {
  roleTitle: string;
  department: string;
  positionsOpen: number;
  salaryBandMin: number | null;
  salaryBandMax: number | null;
  status: CampaignStatus;
  openedDate: string | null;
  closedDate: string | null;
  publicSlug: string;
  screeningQualifiers: string[];
  feedbackDimensions: string[];
  assignmentStageEnabled: boolean;
}

export async function createCampaign(input: CampaignInput): Promise<CampaignRow> {
  validate(input);
  const slug = await uniqueSlug(input.publicSlug);
  const { rows } = await pool.query<CampaignRow>(
    `INSERT INTO campaign (
       role_title, department, positions_open, salary_band_min, salary_band_max,
       status, opened_date, closed_date, public_slug, screening_qualifiers,
       feedback_dimensions, assignment_stage_enabled
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      input.roleTitle,
      input.department,
      input.positionsOpen,
      input.salaryBandMin,
      input.salaryBandMax,
      input.status,
      input.openedDate,
      input.closedDate,
      slug,
      asPgArray(input.screeningQualifiers),
      asPgArray(input.feedbackDimensions),
      input.assignmentStageEnabled,
    ]
  );
  return rows[0];
}

export async function updateCampaign(
  campaignId: string,
  input: CampaignInput
): Promise<CampaignRow | null> {
  validate(input);
  const slug = await uniqueSlug(input.publicSlug, campaignId);
  const { rows } = await pool.query<CampaignRow>(
    `UPDATE campaign SET
       role_title = $2, department = $3, positions_open = $4,
       salary_band_min = $5, salary_band_max = $6, status = $7,
       opened_date = $8, closed_date = $9, public_slug = $10,
       screening_qualifiers = $11, feedback_dimensions = $12,
       assignment_stage_enabled = $13
     WHERE campaign_id = $1 RETURNING *`,
    [
      campaignId,
      input.roleTitle,
      input.department,
      input.positionsOpen,
      input.salaryBandMin,
      input.salaryBandMax,
      input.status,
      input.openedDate,
      input.closedDate,
      slug,
      asPgArray(input.screeningQualifiers),
      asPgArray(input.feedbackDimensions),
      input.assignmentStageEnabled,
    ]
  );
  return rows[0] ?? null;
}

export async function listCampaignQuestions(campaignId: string): Promise<CampaignQuestionRow[]> {
  const { rows } = await pool.query<CampaignQuestionRow>(
    `SELECT cq.*, q.text, q.type, q.options, q.active
       FROM campaign_question cq
       JOIN question q ON q.question_id = cq.question_id
      WHERE cq.campaign_id = $1
      ORDER BY cq.display_order ASC, q.text ASC`,
    [campaignId]
  );
  return rows;
}

export interface CampaignQuestionInput {
  questionId: string;
  displayOrder: number;
  isRequired: boolean;
  isKnockout: boolean;
}

/**
 * Replaces the campaign's question set in one transaction. Existing
 * applications are unaffected: they hold their own snapshot (R5).
 */
export async function replaceCampaignQuestions(
  campaignId: string,
  items: CampaignQuestionInput[]
): Promise<void> {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.questionId)) {
      throw new Error('A question can only appear once on a campaign');
    }
    seen.add(item.questionId);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM campaign_question WHERE campaign_id = $1', [campaignId]);
    for (const item of items) {
      await client.query(
        `INSERT INTO campaign_question (campaign_id, question_id, display_order, is_required, is_knockout)
         VALUES ($1, $2, $3, $4, $5)`,
        [campaignId, item.questionId, item.displayOrder, item.isRequired, item.isKnockout]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'campaign';
}

async function uniqueSlug(desired: string, exceptCampaignId?: string): Promise<string> {
  const base = slugify(desired);
  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const { rows } = await pool.query<{ campaign_id: string }>(
      'SELECT campaign_id FROM campaign WHERE public_slug = $1',
      [candidate]
    );
    if (rows.length === 0 || rows[0].campaign_id === exceptCampaignId) return candidate;
  }
  throw new Error('Could not generate a unique public URL');
}

function validate(input: CampaignInput): void {
  if (!input.roleTitle.trim()) throw new Error('Role title is required');
  if (!input.department.trim()) throw new Error('Department is required');
  if (!(CAMPAIGN_STATUSES as readonly string[]).includes(input.status)) {
    throw new Error('Select a valid status');
  }
  if (!Number.isInteger(input.positionsOpen) || input.positionsOpen < 1) {
    throw new Error('Positions open must be at least 1');
  }
  if (input.screeningQualifiers.length > 2) {
    throw new Error('At most two screening qualifiers');
  }
  if (input.feedbackDimensions.length > 4) {
    throw new Error('At most four feedback dimensions');
  }
}

function asPgArray(values: string[]): string[] | null {
  return values.length === 0 ? null : values;
}
