/**
 * Shared enumerations per PRD §6.
 * This is the single constants module the whole application reads from.
 * No free text where an enum exists (rule R2). The SQL CHECK constraints in
 * migrations/ mirror these lists; change both together, dev branch first.
 */

// ---------------------------------------------------------------------------
// §6.1 Application stages
// ---------------------------------------------------------------------------

/** Ordered pipeline stages. Stages are skippable — one list serves every role. */
export const PIPELINE_STAGES = [
  'applied', // unreviewed, by definition
  'shortlisted', // reviewed, worth calling, not yet called — the call queue
  'screened', // telephonic screen completed, advancing
  'assignment', // used per candidate, on a need basis — not configured per campaign
  'interviewing', // one or more rounds scheduled or completed
  'offered', // offer extended
  'offer_accepted', // accepted, in notice period, not yet joined
  'joined', // started. Closures count here.
] as const;

/** Terminal stages sit outside the pipeline board and require an outcome_reason. */
export const TERMINAL_STAGES = ['rejected', 'withdrawn', 'went_silent'] as const;

export const ALL_STAGES = [...PIPELINE_STAGES, ...TERMINAL_STAGES] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type TerminalStage = (typeof TERMINAL_STAGES)[number];
export type Stage = (typeof ALL_STAGES)[number];

export function isTerminalStage(stage: Stage): stage is TerminalStage {
  return (TERMINAL_STAGES as readonly string[]).includes(stage);
}

export function isPipelineStage(stage: string): stage is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(stage);
}

export function isStage(value: string): value is Stage {
  return (ALL_STAGES as readonly string[]).includes(value);
}

/**
 * Aging SLAs in weekday clock-hours (Mon–Fri, 24h per weekday, Asia/Kolkata).
 * `joined` and terminal stages are omitted — they do not age.
 */
export const STAGE_AGING_WEEKDAY_HOURS: Partial<Record<Stage, number>> = {
  applied: 48,
  shortlisted: 72,
  screened: 40,
  assignment: 40,
  interviewing: 40,
  offered: 40,
  // Notice-period window. 30 weekday days, not the 5-day stall clock.
  offer_accepted: 30 * 24,
};

export const WEEKDAY_TIMEZONE = 'Asia/Kolkata';

// ---------------------------------------------------------------------------
// §6.2 Outcome reasons — every reason is attributed `ours` or `theirs`
// ---------------------------------------------------------------------------

export const OUTCOME_ATTRIBUTIONS = ['ours', 'theirs'] as const;
export type OutcomeAttribution = (typeof OUTCOME_ATTRIBUTIONS)[number];

export const OUTCOME_REASONS = {
  // Attributed to us (`ours`)
  experience_below_requirement: 'ours',
  craft_below_bar: 'ours',
  wrong_specialism: 'ours',
  comp_expectation_above_band: 'ours',
  notice_period_unworkable: 'ours',
  location_or_mode_mismatch: 'ours',
  communication_client_readiness: 'ours',
  strong_candidate_role_closed: 'ours', // talent pool
  strong_candidate_better_fit_elsewhere: 'ours', // talent pool

  // Attributed to them (`theirs`)
  accepted_another_offer: 'theirs',
  counteroffer_from_current_employer: 'theirs',
  declined_on_compensation: 'theirs',
  declined_on_role_or_agency: 'theirs',
  declined_on_location_or_timing: 'theirs',
  withdrew_mid_process: 'theirs',
  went_silent: 'theirs',
  no_show: 'theirs',
  unreachable: 'theirs',
  accepted_then_did_not_join: 'theirs',
} as const satisfies Record<string, OutcomeAttribution>;

export type OutcomeReason = keyof typeof OUTCOME_REASONS;
export const OUTCOME_REASON_LIST = Object.keys(OUTCOME_REASONS) as OutcomeReason[];

// ---------------------------------------------------------------------------
// §6.3 Screen outcomes
// ---------------------------------------------------------------------------

export const SCREEN_OUTCOMES = ['advance', 'reject', 'not_interested', 'unreachable'] as const;
export type ScreenOutcome = (typeof SCREEN_OUTCOMES)[number];

// ---------------------------------------------------------------------------
// §6.4 Round attendance
// ---------------------------------------------------------------------------

export const ROUND_ATTENDANCE = [
  'attended',
  'candidate_no_show',
  'rescheduled_by_us',
  'rescheduled_by_candidate',
  'cancelled',
] as const;
export type RoundAttendance = (typeof ROUND_ATTENDANCE)[number];

// ---------------------------------------------------------------------------
// §6.5 Verdicts (shared by screens and rounds)
// ---------------------------------------------------------------------------

export const VERDICTS = ['strong_yes', 'yes', 'no', 'strong_no'] as const;
export type Verdict = (typeof VERDICTS)[number];

// ---------------------------------------------------------------------------
// §6.6 Event types
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  'application_received',
  'outreach_attempted',
  'contact_made',
  'screen_conducted',
  'round_scheduled',
  'round_outcome_recorded',
  'assignment_sent',
  'assignment_received',
  'offer_made',
  'stage_changed',
  'owner_changed',
  'note_added',
  'consent_withdrawn',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Event channels per §5.8. */
export const EVENT_CHANNELS = ['call', 'whatsapp', 'email', 'in_person', 'system'] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

// ---------------------------------------------------------------------------
// §6.7 Sources
// ---------------------------------------------------------------------------

export const SOURCES = [
  'linkedin',
  'instagram',
  'referral',
  'campus',
  'job_board',
  'website_direct',
  'agency_database', // sourced from our own repository — tracks Goal G1
  'consultant',
  'other',
] as const;
export type Source = (typeof SOURCES)[number];

// ---------------------------------------------------------------------------
// §5.2 Campaign status
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUSES = ['open', 'on_hold', 'closed'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// ---------------------------------------------------------------------------
// §5.6 Round modes
// ---------------------------------------------------------------------------

export const ROUND_MODES = ['in_person', 'video', 'phone'] as const;
export type RoundMode = (typeof ROUND_MODES)[number];

// ---------------------------------------------------------------------------
// §5.7 / §4 Staff roles
// ---------------------------------------------------------------------------

export const SYSTEM_ROLES = ['admin', 'recruiter', 'partner', 'interviewer_no_login'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Roles that can authenticate. Interviewers exist as data only (§4). */
export const LOGIN_ROLES = ['admin', 'recruiter', 'partner'] as const;
export type LoginRole = (typeof LOGIN_ROLES)[number];

// ---------------------------------------------------------------------------
// §5.9 Question types
// ---------------------------------------------------------------------------

export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'select',
  'multi_select',
  'url',
  'file',
  'number',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Department apply questions: structured types only (M2). */
export const DEPARTMENT_APPLY_QUESTION_TYPES = ['select', 'multi_select', 'number'] as const;
export type DepartmentApplyQuestionType = (typeof DEPARTMENT_APPLY_QUESTION_TYPES)[number];

export const FREE_TEXT_QUESTION_TYPES = ['short_text', 'long_text'] as const;

export const MAX_DEPARTMENT_APPLY_QUESTIONS = 3;
export const MAX_CAMPAIGN_APPLY_QUESTIONS = 3;
export const MAX_CAMPAIGN_FREE_TEXT_QUESTIONS = 2;
export const UNIVERSAL_APPLY_QUESTION_COUNT = 10;
export const MAX_VISIBLE_APPLY_QUESTIONS = 16;
export const FREE_TEXT_CHAR_LIMIT = 500;

export const PRODUCT_NAME = 'HR Pulse';
export const PRODUCT_FULL_NAME = 'Brand Catapult — HR Pulse';

/** Shown on each of the three department assessment sets (§5.10). */
export const DEPARTMENT_ASSESSMENT_INHERIT_COPY =
  'These apply to every campaign in this department. Set once — campaigns inherit them automatically.';

/**
 * Person tags (§5.1). Empty until TA signs off the controlled vocabulary
 * (PRD §12). Assignment UI appears once this list is non-empty.
 */
export const PERSON_TAGS = [] as const;
export type PersonTag = (typeof PERSON_TAGS)[number];

/**
 * Apply-form current city. NCR first, then major Indian cities, then Other.
 * Free text is not accepted (R2) — the public form is a searchable picker
 * over this list only.
 */
export const APPLY_CITIES = [
  // NCR
  'Delhi',
  'New Delhi',
  'Noida',
  'Greater Noida',
  'Gurugram',
  'Ghaziabad',
  'Faridabad',
  // Major metros / hubs
  'Mumbai',
  'Bengaluru',
  'Hyderabad',
  'Chennai',
  'Pune',
  'Kolkata',
  'Ahmedabad',
  'Jaipur',
  'Chandigarh',
  'Lucknow',
  'Indore',
  'Kochi',
  'Coimbatore',
  'Vadodara',
  'Surat',
  'Nagpur',
  'Bhopal',
  'Goa',
  'Dehradun',
  'Other',
] as const;
export type ApplyCity = (typeof APPLY_CITIES)[number];

export function isApplyCity(value: string): value is ApplyCity {
  return (APPLY_CITIES as readonly string[]).includes(value);
}
