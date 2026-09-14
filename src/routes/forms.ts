import { QUESTION_TYPES, type QuestionType } from '../constants';
import { jobDescriptionHasText, sanitizeJobDescription } from '../html';

export function parseQuestionForm(
  body: Record<string, unknown>
): { text: string; type: QuestionType; options: string[] | null } | { error: string } {
  const text = String(body.text ?? '').trim();
  const type = String(body.type ?? '');
  const optionsRaw = String(body.options ?? '');
  const options = optionsRaw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!text) return { error: 'Question text is required.' };
  if (!(QUESTION_TYPES as readonly string[]).includes(type)) {
    return { error: 'Select a valid question type.' };
  }
  const needsOptions = type === 'select' || type === 'multi_select';
  if (needsOptions && options.length === 0) {
    return { error: 'Single choice and Multiple choice questions need at least one option (one per line).' };
  }
  return {
    text,
    type: type as QuestionType,
    options: needsOptions ? options : null,
  };
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value == null || value === '') return [];
  return [String(value)];
}

export interface ParsedCampaignForm {
  roleTitle: string;
  departmentId: string;
  jobDescription: string;
  positionsOpen: number;
  salaryBandMin: number | null;
  salaryBandMax: number | null;
  showSalaryPublicly: boolean;
  status: 'open' | 'on_hold' | 'closed';
  publicSlug: string;
}

export function parseCampaignForm(
  body: Record<string, unknown>,
  mode: 'create' | 'edit'
): ParsedCampaignForm | { error: string } {
  const roleTitle = String(body.role_title ?? '').trim();
  const departmentId = String(body.department_id ?? '').trim();
  const jobDescription = sanitizeJobDescription(String(body.job_description ?? ''));
  const positionsOpen = Number(body.positions_open ?? 1);
  const salaryBandMin =
    body.salary_band_min === '' || body.salary_band_min == null ? null : Number(body.salary_band_min);
  const salaryBandMax =
    body.salary_band_max === '' || body.salary_band_max == null ? null : Number(body.salary_band_max);
  const showSalaryPublicly = String(body.show_salary_publicly ?? '') === 'true';
  const status = mode === 'create' ? 'open' : String(body.status ?? 'open');
  const publicSlug = String(body.public_slug ?? '').trim();

  if (!roleTitle) return { error: 'Role title is required.' };
  if (!departmentId) return { error: 'Select a department.' };
  if (!/^[0-9a-f-]{36}$/i.test(departmentId)) {
    return { error: 'Select a department from the list.' };
  }
  if (!jobDescriptionHasText(jobDescription)) return { error: 'Job description is required.' };
  if (!Number.isInteger(positionsOpen) || positionsOpen < 1) {
    return { error: 'Positions open must be a whole number of at least 1.' };
  }
  if (salaryBandMin != null && !Number.isFinite(salaryBandMin)) {
    return { error: 'Minimum salary must be a number.' };
  }
  if (salaryBandMax != null && !Number.isFinite(salaryBandMax)) {
    return { error: 'Maximum salary must be a number.' };
  }
  if (!['open', 'on_hold', 'closed'].includes(status)) {
    return { error: 'Select a valid status.' };
  }

  return {
    roleTitle,
    departmentId,
    jobDescription,
    positionsOpen,
    salaryBandMin,
    salaryBandMax,
    showSalaryPublicly,
    status: status as ParsedCampaignForm['status'],
    publicSlug,
  };
}

export function parseQuestionBuilderForm(
  body: Record<string, unknown>
): { questionId: string; displayOrder: number; isRequired: boolean; isKnockout: boolean }[] {
  const selected = asArray(body.selected);
  return selected.map((questionId, index) => {
    const displayOrder = Number(body[`order_${questionId}`] ?? index + 1);
    return {
      questionId,
      displayOrder: Number.isFinite(displayOrder) ? displayOrder : index + 1,
      isRequired: String(body[`required_${questionId}`] ?? '') === 'on',
      isKnockout: String(body[`knockout_${questionId}`] ?? '') === 'on',
    };
  });
}

export function parseDepartmentForm(
  body: Record<string, unknown>
): { name: string; screeningQualifiers: string[]; feedbackDimensions: string[] } | { error: string } {
  const name = String(body.name ?? '').trim();
  const screeningQualifiers = [
    String(body.qualifier_1 ?? '').trim(),
    String(body.qualifier_2 ?? '').trim(),
  ].filter(Boolean);
  const feedbackDimensions = [
    String(body.dimension_1 ?? '').trim(),
    String(body.dimension_2 ?? '').trim(),
    String(body.dimension_3 ?? '').trim(),
    String(body.dimension_4 ?? '').trim(),
  ].filter(Boolean);
  if (!name) return { error: 'Department name is required.' };
  return { name, screeningQualifiers, feedbackDimensions };
}

export function parseDepartmentQuestionBuilder(
  body: Record<string, unknown>
): { questionId: string; displayOrder: number; isRequired: boolean }[] {
  return parseQuestionBuilderForm(body).map(({ questionId, displayOrder, isRequired }) => ({
    questionId,
    displayOrder,
    isRequired,
  }));
}
