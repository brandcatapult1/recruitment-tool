import { pool } from '../db/pool';
import { QUESTION_TYPES, type QuestionType } from '../constants';

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
 */

export interface QuestionRow {
  question_id: string;
  text: string;
  type: QuestionType;
  options: string[] | null;
  active: boolean;
}

export async function listQuestions(includeInactive = true): Promise<QuestionRow[]> {
  const { rows } = await pool.query<QuestionRow>(
    `SELECT * FROM question ${includeInactive ? '' : 'WHERE active = true'}
      ORDER BY active DESC, text ASC`
  );
  return rows;
}

/** Selectable in a campaign's question builder: active questions only. */
export async function listSelectableQuestions(): Promise<QuestionRow[]> {
  return listQuestions(false);
}

export async function getQuestion(questionId: string): Promise<QuestionRow | null> {
  const { rows } = await pool.query<QuestionRow>(
    'SELECT * FROM question WHERE question_id = $1',
    [questionId]
  );
  return rows[0] ?? null;
}

export interface QuestionInput {
  text: string;
  type: QuestionType;
  options: string[] | null;
}

export async function createQuestion(input: QuestionInput): Promise<QuestionRow> {
  validate(input);
  const { rows } = await pool.query<QuestionRow>(
    'INSERT INTO question (text, type, options) VALUES ($1, $2, $3) RETURNING *',
    [input.text, input.type, input.options]
  );
  return rows[0];
}

export async function updateQuestion(
  questionId: string,
  input: QuestionInput
): Promise<QuestionRow | null> {
  validate(input);
  const { rows } = await pool.query<QuestionRow>(
    'UPDATE question SET text = $2, type = $3, options = $4 WHERE question_id = $1 RETURNING *',
    [questionId, input.text, input.type, input.options]
  );
  return rows[0] ?? null;
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
  if (!input.text.trim()) throw new Error('Question text is required');
  if (!(QUESTION_TYPES as readonly string[]).includes(input.type)) {
    throw new Error(`Unknown question type: ${input.type}`);
  }
  const needsOptions = input.type === 'select' || input.type === 'multi_select';
  if (needsOptions && (!input.options || input.options.length === 0)) {
    throw new Error('Select and multi-select questions need at least one option');
  }
}
