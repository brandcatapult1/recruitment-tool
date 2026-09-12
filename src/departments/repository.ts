import { pool } from '../db/pool';
import {
  DEPARTMENT_APPLY_QUESTION_TYPES,
  MAX_DEPARTMENT_APPLY_QUESTIONS,
  type QuestionType,
} from '../constants';

export interface DepartmentRow {
  department_id: string;
  name: string;
  screening_qualifiers: string[] | null;
  feedback_dimensions: string[] | null;
  active: boolean;
}

export interface DepartmentQuestionRow {
  department_question_id: string;
  department_id: string;
  question_id: string;
  display_order: number;
  is_required: boolean;
  text: string;
  type: QuestionType;
  options: string[] | null;
  active: boolean;
}

export async function listDepartments(includeInactive = true): Promise<DepartmentRow[]> {
  const { rows } = await pool.query<DepartmentRow>(
    `SELECT * FROM department ${includeInactive ? '' : 'WHERE active = true'}
      ORDER BY active DESC, name ASC`
  );
  return rows;
}

export async function listActiveDepartments(): Promise<DepartmentRow[]> {
  return listDepartments(false);
}

export async function getDepartment(departmentId: string): Promise<DepartmentRow | null> {
  const { rows } = await pool.query<DepartmentRow>(
    'SELECT * FROM department WHERE department_id = $1',
    [departmentId]
  );
  return rows[0] ?? null;
}

export async function departmentExists(departmentId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM department WHERE department_id = $1', [
    departmentId,
  ]);
  return rows.length > 0;
}

export interface DepartmentInput {
  name: string;
  screeningQualifiers: string[];
  feedbackDimensions: string[];
}

export async function createDepartment(input: DepartmentInput): Promise<DepartmentRow> {
  validate(input);
  const { rows } = await pool.query<DepartmentRow>(
    `INSERT INTO department (name, screening_qualifiers, feedback_dimensions)
     VALUES ($1, $2, $3) RETURNING *`,
    [input.name, asPgArray(input.screeningQualifiers), asPgArray(input.feedbackDimensions)]
  );
  return rows[0];
}

export async function updateDepartment(
  departmentId: string,
  input: DepartmentInput
): Promise<DepartmentRow | null> {
  validate(input);
  const { rows } = await pool.query<DepartmentRow>(
    `UPDATE department
        SET name = $2, screening_qualifiers = $3, feedback_dimensions = $4
      WHERE department_id = $1 RETURNING *`,
    [departmentId, input.name, asPgArray(input.screeningQualifiers), asPgArray(input.feedbackDimensions)]
  );
  return rows[0] ?? null;
}

export async function setDepartmentActive(
  departmentId: string,
  active: boolean
): Promise<DepartmentRow | null> {
  const { rows } = await pool.query<DepartmentRow>(
    'UPDATE department SET active = $2 WHERE department_id = $1 RETURNING *',
    [departmentId, active]
  );
  return rows[0] ?? null;
}

export async function listDepartmentQuestions(departmentId: string): Promise<DepartmentQuestionRow[]> {
  const { rows } = await pool.query<DepartmentQuestionRow>(
    `SELECT dq.*, q.text, q.type, q.options, q.active
       FROM department_question dq
       JOIN question q ON q.question_id = dq.question_id
      WHERE dq.department_id = $1
      ORDER BY dq.display_order ASC, q.text ASC`,
    [departmentId]
  );
  return rows;
}

export interface DepartmentQuestionInput {
  questionId: string;
  displayOrder: number;
  isRequired: boolean;
}

export async function replaceDepartmentQuestions(
  departmentId: string,
  items: DepartmentQuestionInput[]
): Promise<void> {
  if (items.length > MAX_DEPARTMENT_APPLY_QUESTIONS) {
    throw new Error(
      `A department can have at most ${MAX_DEPARTMENT_APPLY_QUESTIONS} apply questions (the 16-question cap).`
    );
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.questionId)) throw new Error('A question can only appear once');
    seen.add(item.questionId);
  }

  if (items.length > 0) {
    const { rows } = await pool.query<{ question_id: string; type: QuestionType }>(
      'SELECT question_id, type FROM question WHERE question_id = ANY($1::uuid[])',
      [items.map((i) => i.questionId)]
    );
    for (const row of rows) {
      if (!(DEPARTMENT_APPLY_QUESTION_TYPES as readonly string[]).includes(row.type)) {
        throw new Error(
          'Department apply questions must be select, multi-select or number. Free text is not permitted at this tier.'
        );
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM department_question WHERE department_id = $1', [departmentId]);
    for (const item of items) {
      await client.query(
        `INSERT INTO department_question (department_id, question_id, display_order, is_required)
         VALUES ($1, $2, $3, $4)`,
        [departmentId, item.questionId, item.displayOrder, item.isRequired]
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

function validate(input: DepartmentInput): void {
  if (!input.name.trim()) throw new Error('Department name is required');
  if (input.screeningQualifiers.length > 2) throw new Error('At most two screening qualifiers');
  if (input.feedbackDimensions.length > 4) throw new Error('At most four feedback dimensions');
}

function asPgArray(values: string[]): string[] | null {
  return values.length === 0 ? null : values;
}
