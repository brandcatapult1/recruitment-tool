import { pool } from '../db/pool';
import {
  CAMPAIGN_STATUSES,
  FREE_TEXT_QUESTION_TYPES,
  MAX_CAMPAIGN_APPLY_QUESTIONS,
  MAX_CAMPAIGN_FREE_TEXT_QUESTIONS,
  type CampaignStatus,
} from '../constants';
import { departmentExists } from '../departments/repository';
import { UserFacingError } from '../http/errors';
import { jobDescriptionHasText } from '../html';

export interface CampaignRow {
  campaign_id: string;
  role_title: string;
  department_id: string;
  department_name: string;
  job_description: string;
  positions_open: number;
  salary_band_min: number | null;
  salary_band_max: number | null;
  show_salary_publicly: boolean;
  status: CampaignStatus;
  opened_date: string | null;
  closed_date: string | null;
  public_slug: string;
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

const CAMPAIGN_SELECT = `
  SELECT c.*, d.name AS department_name
    FROM campaign c
    JOIN department d ON d.department_id = c.department_id
`;

export async function listCampaigns(): Promise<CampaignRow[]> {
  const { rows } = await pool.query<CampaignRow>(
    `${CAMPAIGN_SELECT}
      ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END,
               c.opened_date DESC NULLS LAST,
               c.role_title ASC`
  );
  return rows;
}

export async function getCampaign(campaignId: string): Promise<CampaignRow | null> {
  const { rows } = await pool.query<CampaignRow>(`${CAMPAIGN_SELECT} WHERE c.campaign_id = $1`, [
    campaignId,
  ]);
  return rows[0] ?? null;
}

export async function getOpenCampaignBySlug(slug: string): Promise<CampaignRow | null> {
  const { rows } = await pool.query<CampaignRow>(
    `${CAMPAIGN_SELECT} WHERE c.public_slug = $1 AND c.status = 'open'`,
    [slug]
  );
  return rows[0] ?? null;
}

export interface CampaignInput {
  roleTitle: string;
  departmentId: string;
  jobDescription: string;
  positionsOpen: number;
  salaryBandMin: number | null;
  salaryBandMax: number | null;
  showSalaryPublicly: boolean;
  status: CampaignStatus;
  openedDate: string | null;
  publicSlug: string;
}

export async function createCampaign(input: CampaignInput): Promise<CampaignRow> {
  await validate(input);
  const slug = await uniqueSlug(input.publicSlug);
  const { rows } = await pool.query<CampaignRow>(
    `INSERT INTO campaign (
       role_title, department_id, job_description, positions_open,
       salary_band_min, salary_band_max, show_salary_publicly,
       status, opened_date, closed_date, public_slug
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,NULL,$9)
     RETURNING campaign_id`,
    [
      input.roleTitle,
      input.departmentId,
      input.jobDescription,
      input.positionsOpen,
      input.salaryBandMin,
      input.salaryBandMax,
      input.showSalaryPublicly,
      input.openedDate,
      slug,
    ]
  );
  const created = await getCampaign(rows[0].campaign_id);
  if (!created) throw new Error('Campaign insert failed');
  return created;
}

export async function updateCampaign(
  campaignId: string,
  input: CampaignInput,
  previousStatus: CampaignStatus
): Promise<CampaignRow | null> {
  await validate(input);
  const slug = await uniqueSlug(input.publicSlug, campaignId);
  let closedDate: string | null = null;
  if (input.status === 'closed') {
    closedDate =
      previousStatus === 'closed'
        ? (await getCampaign(campaignId))?.closed_date ?? today()
        : today();
  }
  await pool.query(
    `UPDATE campaign SET
       role_title = $2, department_id = $3, job_description = $4,
       positions_open = $5, salary_band_min = $6, salary_band_max = $7,
       show_salary_publicly = $8, status = $9, closed_date = $10,
       public_slug = $11
     WHERE campaign_id = $1`,
    [
      campaignId,
      input.roleTitle,
      input.departmentId,
      input.jobDescription,
      input.positionsOpen,
      input.salaryBandMin,
      input.salaryBandMax,
      input.showSalaryPublicly,
      input.status,
      closedDate,
      slug,
    ]
  );
  return getCampaign(campaignId);
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

export async function replaceCampaignQuestions(
  campaignId: string,
  items: CampaignQuestionInput[]
): Promise<void> {
  if (items.length > MAX_CAMPAIGN_APPLY_QUESTIONS) {
    throw new UserFacingError(
      `A campaign can have at most ${MAX_CAMPAIGN_APPLY_QUESTIONS} apply questions.`
    );
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.questionId)) {
      throw new UserFacingError('A question can only appear once on a campaign');
    }
    seen.add(item.questionId);
  }

  if (items.length > 0) {
    const { rows } = await pool.query<{ question_id: string; type: string }>(
      'SELECT question_id, type FROM question WHERE question_id = ANY($1::uuid[])',
      [items.map((i) => i.questionId)]
    );
    const freeText = rows.filter((r) =>
      (FREE_TEXT_QUESTION_TYPES as readonly string[]).includes(r.type)
    );
    if (freeText.length > MAX_CAMPAIGN_FREE_TEXT_QUESTIONS) {
      throw new UserFacingError(
        `A campaign can have at most ${MAX_CAMPAIGN_FREE_TEXT_QUESTIONS} free-text questions.`
      );
    }
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

async function validate(input: CampaignInput): Promise<void> {
  if (!input.roleTitle.trim()) throw new Error('Role title is required');
  if (!jobDescriptionHasText(input.jobDescription)) throw new Error('Job description is required');
  if (!(CAMPAIGN_STATUSES as readonly string[]).includes(input.status)) {
    throw new Error('Select a valid status');
  }
  if (!Number.isInteger(input.positionsOpen) || input.positionsOpen < 1) {
    throw new Error('Positions open must be at least 1');
  }
  if (!(await departmentExists(input.departmentId))) {
    throw new Error('Select a department from the list');
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
