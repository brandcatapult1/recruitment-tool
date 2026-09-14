/**
 * Human labels for stored enum values. Database values never change.
 * Views call label(kind, value) — never interpolate a raw enum into copy.
 */

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const QUESTION_TYPE: Record<string, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  select: 'Single choice',
  multi_select: 'Multiple choice',
  url: 'URL',
  file: 'File',
  number: 'Number',
};

const STAGE: Record<string, string> = {
  applied: 'Applied',
  shortlisted: 'Shortlisted',
  screened: 'Screened',
  assignment: 'Assignment',
  interviewing: 'Interviewing',
  offered: 'Offered',
  offer_accepted: 'Offer accepted',
  joined: 'Joined',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  went_silent: 'Went silent',
};

const ROLE: Record<string, string> = {
  admin: 'Admin',
  recruiter: 'Recruiter',
  partner: 'Partner',
  interviewer_no_login: 'Interviewer (no login)',
};

const SOURCE: Record<string, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  referral: 'Referral',
  campus: 'Campus',
  job_board: 'Job board',
  website_direct: 'Website (direct)',
  agency_database: 'Agency database',
  consultant: 'Consultant',
  other: 'Other',
};

const OUTCOME_REASON: Record<string, string> = {
  experience_below_requirement: 'Experience below requirement',
  craft_below_bar: 'Craft below bar',
  wrong_specialism: 'Wrong specialism',
  comp_expectation_above_band: 'Compensation expectation above band',
  notice_period_unworkable: 'Notice period unworkable',
  location_or_mode_mismatch: 'Location or mode mismatch',
  communication_client_readiness: 'Communication / client readiness',
  strong_candidate_role_closed: 'Strong candidate — role closed',
  strong_candidate_better_fit_elsewhere: 'Strong candidate — better fit elsewhere',
  accepted_another_offer: 'Accepted another offer',
  counteroffer_from_current_employer: 'Counteroffer from current employer',
  declined_on_compensation: 'Declined on compensation',
  declined_on_role_or_agency: 'Declined on role or agency',
  declined_on_location_or_timing: 'Declined on location or timing',
  withdrew_mid_process: 'Withdrew mid-process',
  went_silent: 'Went silent',
  no_show: 'No-show',
  unreachable: 'Unreachable',
  accepted_then_did_not_join: 'Accepted then did not join',
};

const ATTENDANCE: Record<string, string> = {
  attended: 'Attended',
  candidate_no_show: 'Candidate no-show',
  rescheduled_by_us: 'Rescheduled by us',
  rescheduled_by_candidate: 'Rescheduled by candidate',
  cancelled: 'Cancelled',
};

const VERDICT: Record<string, string> = {
  strong_yes: 'Strong yes',
  yes: 'Yes',
  no: 'No',
  strong_no: 'Strong no',
};

const CAMPAIGN_STATUS: Record<string, string> = {
  open: 'Open',
  on_hold: 'On hold',
  closed: 'Closed',
};

const SCREEN_OUTCOME: Record<string, string> = {
  advance: 'Advance',
  reject: 'Reject',
  not_interested: 'Not interested',
  unreachable: 'Unreachable',
};

const EVENT_TYPE: Record<string, string> = {
  application_received: 'Application received',
  outreach_attempted: 'Outreach attempted',
  contact_made: 'Contact made',
  screen_conducted: 'Screen conducted',
  round_scheduled: 'Round scheduled',
  round_outcome_recorded: 'Round outcome recorded',
  assignment_sent: 'Assignment sent',
  assignment_received: 'Assignment received',
  offer_made: 'Offer made',
  stage_changed: 'Stage changed',
  owner_changed: 'Owner changed',
  note_added: 'Note added',
  consent_withdrawn: 'Consent withdrawn',
};

const EVENT_CHANNEL: Record<string, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  in_person: 'In person',
  system: 'System',
};

const ROUND_MODE: Record<string, string> = {
  in_person: 'In person',
  video: 'Video',
  phone: 'Phone',
};

const ATTRIBUTION: Record<string, string> = {
  ours: 'Ours',
  theirs: 'Theirs',
};

const MAPS = {
  questionType: QUESTION_TYPE,
  stage: STAGE,
  role: ROLE,
  source: SOURCE,
  outcomeReason: OUTCOME_REASON,
  attendance: ATTENDANCE,
  verdict: VERDICT,
  campaignStatus: CAMPAIGN_STATUS,
  screenOutcome: SCREEN_OUTCOME,
  eventType: EVENT_TYPE,
  eventChannel: EVENT_CHANNEL,
  roundMode: ROUND_MODE,
  attribution: ATTRIBUTION,
} as const;

export type LabelKind = keyof typeof MAPS;

export function label(kind: LabelKind, value: string | null | undefined): string {
  if (value == null || value === '') return '';
  return MAPS[kind][value] ?? humanize(value);
}
