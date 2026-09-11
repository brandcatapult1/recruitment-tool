import { QUESTION_TYPES, type QuestionType } from '../constants';

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
    return { error: 'Select and multi-select questions need at least one option (one per line).' };
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
  department: string;
  positionsOpen: number;
  salaryBandMin: number | null;
  salaryBandMax: number | null;
  status: 'open' | 'on_hold' | 'closed';
  openedDate: string | null;
  closedDate: string | null;
  publicSlug: string;
  screeningQualifiers: string[];
  feedbackDimensions: string[];
  assignmentStageEnabled: boolean;
}

export function parseCampaignForm(
  body: Record<string, unknown>
): ParsedCampaignForm | { error: string } {
  const roleTitle = String(body.role_title ?? '').trim();
  const department = String(body.department ?? '').trim();
  const positionsOpen = Number(body.positions_open ?? 1);
  const salaryBandMin = body.salary_band_min === '' || body.salary_band_min == null
    ? null
    : Number(body.salary_band_min);
  const salaryBandMax = body.salary_band_max === '' || body.salary_band_max == null
    ? null
    : Number(body.salary_band_max);
  const status = String(body.status ?? 'open');
  const openedDate = String(body.opened_date ?? '').trim() || null;
  const closedDate = String(body.closed_date ?? '').trim() || null;
  const publicSlug = String(body.public_slug ?? '').trim();
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
  const assignmentStageEnabled = String(body.assignment_stage_enabled ?? '') === 'true';

  if (!roleTitle) return { error: 'Role title is required.' };
  if (!department) return { error: 'Department is required.' };
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
  if (status === 'closed' && !closedDate) {
    return { error: 'Closed campaigns need a closed date.' };
  }

  return {
    roleTitle,
    department,
    positionsOpen,
    salaryBandMin,
    salaryBandMax,
    status: status as ParsedCampaignForm['status'],
    openedDate,
    closedDate: status === 'closed' ? closedDate : null,
    publicSlug,
    screeningQualifiers,
    feedbackDimensions,
    assignmentStageEnabled,
  };
}

export function parseQuestionBuilderForm(
  body: Record<string, unknown>
): { questionId: string; displayOrder: number; isRequired: boolean; isKnockout: boolean }[] {
  const selected = asArray(body.selected);
  return selected.map((questionId, index) => {
    const orderRaw = body[`order_${questionId}`];
    const displayOrder = Number(orderRaw ?? index + 1);
    return {
      questionId,
      displayOrder: Number.isFinite(displayOrder) ? displayOrder : index + 1,
      isRequired: String(body[`required_${questionId}`] ?? '') === 'on',
      isKnockout: String(body[`knockout_${questionId}`] ?? '') === 'on',
    };
  });
}
