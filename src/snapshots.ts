import type { PoolClient } from 'pg';
import { pool } from './db/pool';
import { QUESTION_TYPES, type QuestionType } from './constants';

/**
 * Configuration snapshots — PRD rule R5.
 *
 * Campaign configuration is editable. Editing it must never retroactively
 * change the meaning of data already recorded against it. So wherever a
 * campaign-configured item is answered or scored, the item itself is stored
 * alongside the response, and responses are read back only from that stored
 * copy.
 *
 * Three places need this, one per configurable thing:
 *
 *   application.question_answers  <- department + campaign apply questions
 *   screen.qualifier_answers      <- department.screening_qualifiers
 *   round.scores                  <- department.feedback_dimensions
 *
 * Two kinds of function live here and the split is the whole safety property:
 *
 *   build*  — called ONCE at the point of answer (M2 submit, M5 screen save,
 *             M6 feedback save). These read live configuration, because that
 *             is what was actually asked at that moment, and return the JSON
 *             to store.
 *
 *   read*   — the ONLY path by which recorded responses are read. They take
 *             the stored JSON and nothing else: there is deliberately no
 *             campaign id parameter, so it is not possible to accidentally
 *             render a past response against current configuration.
 *
 * Configuration is never hard-deleted, only deactivated (R3), so an item
 * referenced by a snapshot can never vanish.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One question exactly as it was asked, plus the answer given. */
export interface QuestionAnswer {
  question_id: string;
  text: string;
  type: QuestionType;
  options: string[] | null;
  is_required: boolean;
  /** Tag and triage only. Never auto-rejects, never changes stage (§5.3). */
  is_knockout: boolean;
  display_order: number;
  tier?: 'department' | 'campaign';
  value: string | string[] | number | null;
}

export interface QuestionAnswersRecord {
  asked_at: string;
  answers: QuestionAnswer[];
}

/** One screening qualifier as it read when the call happened, plus the answer. */
export interface QualifierAnswer {
  position: number;
  text: string;
  value: string | null;
}

export interface QualifierAnswersRecord {
  asked_at: string;
  qualifiers: QualifierAnswer[];
}

/** One feedback dimension as it was labelled when scored, plus the score. */
export interface DimensionScore {
  position: number;
  label: string;
  /** 1–5 per §5.6, or null where the round was not scored. */
  score: number | null;
}

export interface RoundScoresRecord {
  scored_at: string;
  dimensions: DimensionScore[];
}

// ---------------------------------------------------------------------------
// Builders — read live configuration at the point of answer
// ---------------------------------------------------------------------------

export type QuestionValues = Record<string, string | string[] | number | null | undefined>;

/**
 * Builds application.question_answers for a submission (M2 calls this).
 * `values` is keyed by question_id; anything absent is recorded as null so the
 * snapshot always shows the full set of questions that were on screen.
 */
export interface LiveApplyQuestion {
  question_id: string;
  text: string;
  type: QuestionType;
  options: string[] | null;
  is_required: boolean;
  is_knockout: boolean;
  display_order: number;
  tier: 'department' | 'campaign';
}

export async function loadLiveApplyQuestions(
  campaignId: string,
  client?: PoolClient
): Promise<LiveApplyQuestion[]> {
  const runner = client ?? pool;
  const { rows } = await runner.query<LiveApplyQuestion>(
    `SELECT * FROM (
        SELECT q.question_id, q.text, q.type, q.options,
               dq.is_required, false AS is_knockout, dq.display_order,
               'department'::text AS tier, 0 AS tier_sort
          FROM department_question dq
          JOIN campaign c ON c.department_id = dq.department_id
          JOIN question q ON q.question_id = dq.question_id
         WHERE c.campaign_id = $1
        UNION ALL
        SELECT q.question_id, q.text, q.type, q.options,
               cq.is_required, cq.is_knockout, cq.display_order,
               'campaign'::text AS tier, 1 AS tier_sort
          FROM campaign_question cq
          JOIN question q ON q.question_id = cq.question_id
         WHERE cq.campaign_id = $1
      ) qset
      ORDER BY tier_sort ASC, display_order ASC, text ASC`,
    [campaignId]
  );
  return rows;
}

export async function buildQuestionAnswers(
  campaignId: string,
  values: QuestionValues = {},
  client?: PoolClient
): Promise<QuestionAnswersRecord> {
  const rows = await loadLiveApplyQuestions(campaignId, client);
  return {
    asked_at: new Date().toISOString(),
    answers: rows.map((r) => ({
      question_id: r.question_id,
      text: r.text,
      type: r.type,
      options: r.options,
      is_required: r.is_required,
      is_knockout: r.is_knockout,
      display_order: r.display_order,
      tier: r.tier,
      value: values[r.question_id] ?? null,
    })),
  };
}

/**
 * Builds screen.qualifier_answers for a telephonic screen (M5 calls this).
 * `values` is positional, matching the campaign's department qualifiers.
 */
export async function buildQualifierAnswers(
  campaignId: string,
  values: (string | null | undefined)[] = [],
  client?: PoolClient
): Promise<QualifierAnswersRecord> {
  const runner = client ?? pool;
  const { rows } = await runner.query<{ screening_qualifiers: string[] | null }>(
    `SELECT d.screening_qualifiers
       FROM campaign c
       JOIN department d ON d.department_id = c.department_id
      WHERE c.campaign_id = $1`,
    [campaignId]
  );
  if (rows.length === 0) throw new Error(`Unknown campaign ${campaignId}`);
  const qualifiers = rows[0].screening_qualifiers ?? [];

  return {
    asked_at: new Date().toISOString(),
    qualifiers: qualifiers.map((text, position) => ({
      position,
      text,
      value: values[position] ?? null,
    })),
  };
}

/**
 * Builds round.scores for an interview round (M6 calls this).
 * `values` is positional, matching the campaign's department dimensions.
 */
export async function buildRoundScores(
  campaignId: string,
  values: (number | null | undefined)[] = [],
  client?: PoolClient
): Promise<RoundScoresRecord> {
  const runner = client ?? pool;
  const { rows } = await runner.query<{ feedback_dimensions: string[] | null }>(
    `SELECT d.feedback_dimensions
       FROM campaign c
       JOIN department d ON d.department_id = c.department_id
      WHERE c.campaign_id = $1`,
    [campaignId]
  );
  if (rows.length === 0) throw new Error(`Unknown campaign ${campaignId}`);
  const dimensions = rows[0].feedback_dimensions ?? [];

  return {
    scored_at: new Date().toISOString(),
    dimensions: dimensions.map((label, position) => {
      const score = values[position] ?? null;
      if (score !== null && !(Number.isInteger(score) && score >= 1 && score <= 5)) {
        throw new Error(`Score for "${label}" must be an integer 1–5, got ${score}`);
      }
      return { position, label, score };
    }),
  };
}

// ---------------------------------------------------------------------------
// Readers — the only path by which recorded responses are read (R5)
// ---------------------------------------------------------------------------

export function readQuestionAnswers(stored: unknown): QuestionAnswer[] {
  if (stored == null) return [];
  const record = asRecord(stored, 'question_answers');
  const answers = record.answers;
  if (!Array.isArray(answers)) {
    throw new Error('Malformed question_answers: expected an "answers" array');
  }
  return answers.map((raw, i) => {
    const a = asRecord(raw, `question_answers.answers[${i}]`);
    const type = String(a.type);
    if (!(QUESTION_TYPES as readonly string[]).includes(type)) {
      throw new Error(`Malformed question_answers: unknown question type "${type}"`);
    }
    return {
      question_id: String(a.question_id),
      text: String(a.text),
      type: type as QuestionType,
      options: Array.isArray(a.options) ? a.options.map(String) : null,
      is_required: Boolean(a.is_required),
      is_knockout: Boolean(a.is_knockout),
      display_order: Number(a.display_order ?? i),
      tier: a.tier === 'department' || a.tier === 'campaign' ? a.tier : undefined,
      value: (a.value ?? null) as QuestionAnswer['value'],
    };
  });
}

export function readQualifierAnswers(stored: unknown): QualifierAnswer[] {
  if (stored == null) return [];
  const record = asRecord(stored, 'qualifier_answers');
  const qualifiers = record.qualifiers;
  if (!Array.isArray(qualifiers)) {
    throw new Error('Malformed qualifier_answers: expected a "qualifiers" array');
  }
  return qualifiers.map((raw, i) => {
    const q = asRecord(raw, `qualifier_answers.qualifiers[${i}]`);
    return {
      position: Number(q.position ?? i),
      text: String(q.text),
      value: q.value == null ? null : String(q.value),
    };
  });
}

export function readRoundScores(stored: unknown): DimensionScore[] {
  if (stored == null) return [];
  const record = asRecord(stored, 'scores');
  const dimensions = record.dimensions;
  if (!Array.isArray(dimensions)) {
    throw new Error('Malformed scores: expected a "dimensions" array');
  }
  return dimensions.map((raw, i) => {
    const d = asRecord(raw, `scores.dimensions[${i}]`);
    return {
      position: Number(d.position ?? i),
      label: String(d.label),
      score: d.score == null ? null : Number(d.score),
    };
  });
}

/** True if any recorded answer was to a question flagged knockout. Display only. */
export function hasKnockoutAnswer(stored: unknown): boolean {
  return readQuestionAnswers(stored).some((a) => a.is_knockout && a.value != null);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Malformed ${what}: expected an object`);
  }
  return value as Record<string, unknown>;
}
