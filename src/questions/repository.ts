import { pool } from '../db/pool';
import { QUESTION_TYPES, type QuestionType } from '../constants';
import { UserFacingError } from '../http/errors';

/**
 * The question bank (§5.9).
 *
 * Questions are edited in place — the bank is meant to be curated. That is
 * safe because recorded answers carry their own copy of the question as it
 * was asked (R5, src/snapshots.ts), so an edit here can never reach into an
 * application that has already been submitted.
 *
 * There is no delete. Retiring a question sets active = false (R3), which
 * removes it from campaign builders while leaving every campaign that already
 * uses it intact.
 *
 * Brand is set at create and never changes. A department or campaign may only
 * attach questions from its own brand.
 */

export interface QuestionRow {
  question_id: string;
  brand_id: string;
  brand_name: string;
  text: string;
  type: QuestionType;
  options: string[] | null;
  active: boolean;
}

export async function listQuestions(includeInactive = true, brandId?: string): Promise<QuestionRow[]> {
  const clauses: string[] = [];
  const params: string[] = [];
  if (!includeInactive) clauses.push('q.active = true');
  if (brandId) {
    params.push(brandId);
    clauses.push(`q.brand_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query<QuestionRow>(
    `SELECT q.*, b.name AS brand_name
       FROM question q
       JOIN brand b ON b.brand_id = q.brand_id
      ${where}
      ORDER BY b.name ASC, q.active DESC, q.text ASC`,
    params
  );
  return rows;
}

/** Selectable in a campaign's question builder: active questions only. */
export async function listSelectableQuestions(): Promise<QuestionRow[]> {
  return listQuestions(false);
}

export async function getQuestion(questionId: string): Promise<QuestionRow | null> {
  const { rows } = await pool.query<QuestionRow>(
    `SELECT q.*, b.name AS brand_name
       FROM question q
       JOIN brand b ON b.brand_id = q.brand_id
      WHERE q.question_id = $1`,
    [questionId]
  );
  return rows[0] ?? null;
}

export interface QuestionInput {
  text: string;
  type: QuestionType;
  options: string[] | null;
  brandId?: string;
}

export async function createQuestion(input: QuestionInput): Promise<QuestionRow> {
  validate(input);
  if (!input.brandId || !/^[0-9a-f-]{36}$/i.test(input.brandId)) {
    throw new UserFacingError('Select a brand.');
  }
  try {
    const { rows } = await pool.query<{ question_id: string }>(
      'INSERT INTO question (text, type, options, brand_id) VALUES ($1, $2, $3, $4) RETURNING question_id',
      [input.text, input.type, input.options, input.brandId]
    );
    const created = await getQuestion(rows[0].question_id);
    if (!created) throw new Error('Question insert failed');
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new UserFacingError('A question with that wording already exists for this brand.');
    }
    throw err;
  }
}

export async function updateQuestion(
  questionId: string,
  input: QuestionInput
): Promise<QuestionRow | null> {
  validate(input);
  try {
    const { rows } = await pool.query<{ question_id: string }>(
      'UPDATE question SET text = $2, type = $3, options = $4 WHERE question_id = $1 RETURNING question_id',
      [questionId, input.text, input.type, input.options]
    );
    if (!rows[0]) return null;
    return getQuestion(rows[0].question_id);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new UserFacingError('A question with that wording already exists for this brand.');
    }
    throw err;
  }
}

export async function setQuestionActive(
  questionId: string,
  active: boolean
): Promise<QuestionRow | null> {
  const { rows } = await pool.query<QuestionRow>(
    'UPDATE question SET active = $2 WHERE question_id = $1 RETURNING *',
    [questionId, active]
  );
  return rows[0] ?? null;
}

export interface QuestionUsage {
  campaigns: number;
  recordedAnswers: number;
}

/**
 * How widely a question is used, shown when editing so it is obvious that an
 * edit affects future applications only.
 *
 * The recorded-answer count reads the stored snapshots in
 * application.question_answers — it never joins the live bank (R5).
 */
export async function getQuestionUsage(questionId: string): Promise<QuestionUsage> {
  const { rows } = await pool.query<{ campaigns: string; recorded: string }>(
    `SELECT
       (SELECT count(*) FROM campaign_question WHERE question_id = $1) AS campaigns,
       (SELECT count(*) FROM application
          WHERE question_answers -> 'answers' @> $2::jsonb) AS recorded`,
    [questionId, JSON.stringify([{ question_id: questionId }])]
  );
  return {
    campaigns: Number(rows[0].campaigns),
    recordedAnswers: Number(rows[0].recorded),
  };
}

function validate(input: QuestionInput): void {
  if (!input.text.trim()) throw new UserFacingError('Question text is required');
  if (!(QUESTION_TYPES as readonly string[]).includes(input.type)) {
    throw new UserFacingError(`Unknown question type: ${input.type}`);
  }
  const needsOptions = input.type === 'select' || input.type === 'multi_select';
  if (needsOptions && (!input.options || input.options.length === 0)) {
    throw new UserFacingError('Select and multi-select questions need at least one option');
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505';
}
