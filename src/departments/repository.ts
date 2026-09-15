import { pool } from '../db/pool';
import {
  DEPARTMENT_APPLY_QUESTION_TYPES,
  MAX_DEPARTMENT_APPLY_QUESTIONS,
  type QuestionType,
} from '../constants';
import { UserFacingError } from '../http/errors';

export interface DepartmentRow {
  department_id: string;
  brand_id: string;
  brand_name: string;
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
    `SELECT d.*, b.name AS brand_name
       FROM department d
       JOIN brand b ON b.brand_id = d.brand_id
      ${includeInactive ? '' : 'WHERE d.active = true'}
      ORDER BY b.name ASC, d.active DESC, d.name ASC`
  );
  return rows;
}

export async function listActiveDepartments(brandId?: string): Promise<DepartmentRow[]> {
  if (!brandId) return listDepartments(false);
  const { rows } = await pool.query<DepartmentRow>(
    `SELECT d.*, b.name AS brand_name
       FROM department d
       JOIN brand b ON b.brand_id = d.brand_id
      WHERE d.active = true AND d.brand_id = $1
      ORDER BY d.name ASC`,
    [brandId]
  );
  return rows;
}

export async function getDepartment(departmentId: string): Promise<DepartmentRow | null> {
  const { rows } = await pool.query<DepartmentRow>(
    `SELECT d.*, b.name AS brand_name
       FROM department d
       JOIN brand b ON b.brand_id = d.brand_id
      WHERE d.department_id = $1`,
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
  brandId?: string;
  screeningQualifiers: string[];
  feedbackDimensions: string[];
}

export async function createDepartment(input: DepartmentInput): Promise<DepartmentRow> {
  validate(input);
  if (!input.brandId) throw new UserFacingError('Select a brand.');
  try {
    const { rows } = await pool.query<{ department_id: string }>(
      `INSERT INTO department (name, brand_id, screening_qualifiers, feedback_dimensions)
       VALUES ($1, $2, $3, $4) RETURNING department_id`,
      [input.name, input.brandId, asPgArray(input.screeningQualifiers), asPgArray(input.feedbackDimensions)]
    );
    const created = await getDepartment(rows[0].department_id);
    if (!created) throw new Error('Department insert failed');
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new UserFacingError(
        'A department with that name, or a very similar name, already exists for this brand.'
      );
    }
    throw err;
  }
}

export async function updateDepartment(
  departmentId: string,
  input: DepartmentInput
): Promise<DepartmentRow | null> {
  validate(input, { nameOnly: true });
  try {
    await pool.query(
      `UPDATE department
          SET name = $2, screening_qualifiers = $3, feedback_dimensions = $4
        WHERE department_id = $1`,
      [departmentId, input.name, asPgArray(input.screeningQualifiers), asPgArray(input.feedbackDimensions)]
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new UserFacingError(
        'A department with that name, or a very similar name, already exists for this brand.'
      );
    }
    throw err;
  }
  return getDepartment(departmentId);
}

export async function setDepartmentActive(
  departmentId: string,
  active: boolean
): Promise<DepartmentRow | null> {
  try {
    const { rows } = await pool.query<DepartmentRow>(
      'UPDATE department SET active = $2 WHERE department_id = $1 RETURNING *',
      [departmentId, active]
    );
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new UserFacingError(
        'A department with that name, or a very similar name, already exists for this brand.'
      );
    }
    throw err;
  }
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
    throw new UserFacingError(
      `A department can have at most ${MAX_DEPARTMENT_APPLY_QUESTIONS} apply questions.`
    );
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.questionId)) throw new UserFacingError('A question can only appear once');
    seen.add(item.questionId);
  }

  if (items.length > 0) {
    const department = await getDepartment(departmentId);
    if (!department) throw new UserFacingError('Department not found.');
    const { rows } = await pool.query<{ question_id: string; type: QuestionType; brand_id: string }>(
      'SELECT question_id, type, brand_id FROM question WHERE question_id = ANY($1::uuid[])',
      [items.map((i) => i.questionId)]
    );
    if (rows.length !== items.length) {
      throw new UserFacingError('Select questions from this brand\'s bank.');
    }
    for (const row of rows) {
      if (row.brand_id !== department.brand_id) {
        throw new UserFacingError('A department can only use questions from its own brand.');
      }
      if (!(DEPARTMENT_APPLY_QUESTION_TYPES as readonly string[]).includes(row.type)) {
        throw new UserFacingError(
          'Department apply questions must be single choice, multiple choice or number. Free text is not permitted at this tier.'
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

function validate(input: DepartmentInput, opts: { nameOnly?: boolean } = {}): void {
  if (!input.name.trim()) throw new UserFacingError('Department name is required.');
  if (!opts.nameOnly && !input.brandId) throw new UserFacingError('Select a brand.');
  if (input.screeningQualifiers.length > 2) throw new UserFacingError('At most two screening qualifiers');
  if (input.feedbackDimensions.length > 4) throw new UserFacingError('At most four feedback dimensions');
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505';
}

function asPgArray(values: string[]): string[] | null {
  return values.length === 0 ? null : values;
}
