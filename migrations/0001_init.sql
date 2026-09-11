-- M0 foundation schema per PRD §5 and §6.
-- Applied automatically on server startup; runs against the Neon `dev` branch
-- before `main`, always (§13.2).
--
-- Written to be idempotent: every object uses IF NOT EXISTS (or is replaced),
-- so re-running against a database that already holds part or all of this
-- schema completes cleanly instead of colliding.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- §5.7 staff
-- (password_hash is an implementation detail of M0 email+password auth;
--  it is null for interviewer_no_login, who has no credentials by design.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff (
  staff_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  department    text,
  system_role   text NOT NULL CHECK (system_role IN ('admin', 'recruiter', 'partner', 'interviewer_no_login')),
  email         text UNIQUE,
  password_hash text,
  active        boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- §5.1 person — one record per human, the permanent asset
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person (
  person_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text NOT NULL,
  phone           text NOT NULL UNIQUE, -- primary dedupe key, E.164 normalised on write
  alt_phone       text,
  email           text,
  city            text,
  portfolio_url   text,
  linkedin_url    text,
  tags            text[],
  first_seen_date timestamptz,
  first_source    text CHECK (first_source IS NULL OR first_source IN (
                    'linkedin', 'instagram', 'referral', 'campus', 'job_board',
                    'website_direct', 'agency_database', 'consultant', 'other')),
  consent_date    timestamptz,
  do_not_contact  boolean NOT NULL DEFAULT false,
  merged_into     uuid REFERENCES person(person_id)
);

CREATE INDEX IF NOT EXISTS idx_person_email ON person(email);

-- ---------------------------------------------------------------------------
-- §5.2 campaign — a role opening
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign (
  campaign_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_title               text NOT NULL,
  department               text NOT NULL,
  positions_open           integer NOT NULL DEFAULT 1,
  salary_band_min          integer,
  salary_band_max          integer,
  status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'on_hold', 'closed')),
  opened_date              date,
  closed_date              date,
  public_slug              text NOT NULL UNIQUE,
  screening_qualifiers     text[] CHECK (screening_qualifiers IS NULL OR cardinality(screening_qualifiers) <= 2),
  feedback_dimensions      text[] CHECK (feedback_dimensions IS NULL OR cardinality(feedback_dimensions) <= 4),
  assignment_stage_enabled boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- §5.9 question — the question bank
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS question (
  question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('short_text', 'long_text', 'select', 'multi_select', 'url', 'file', 'number')),
  options     text[],
  active      boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- §5.3 campaign_question — join between campaign and question bank
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_question (
  campaign_question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id          uuid NOT NULL REFERENCES campaign(campaign_id),
  question_id          uuid NOT NULL REFERENCES question(question_id),
  display_order        integer NOT NULL,
  is_required          boolean NOT NULL DEFAULT false,
  is_knockout          boolean NOT NULL DEFAULT false -- tag and triage only, never auto-reject
);

CREATE INDEX IF NOT EXISTS idx_campaign_question_campaign ON campaign_question(campaign_id);

-- ---------------------------------------------------------------------------
-- §5.4 application — person + campaign; where stage and outcome live
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS application (
  application_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id            uuid NOT NULL REFERENCES person(person_id),
  campaign_id          uuid NOT NULL REFERENCES campaign(campaign_id),
  owner_staff_id       uuid REFERENCES staff(staff_id),
  applied_date         timestamptz,
  source               text CHECK (source IS NULL OR source IN (
                         'linkedin', 'instagram', 'referral', 'campus', 'job_board',
                         'website_direct', 'agency_database', 'consultant', 'other')),
  stage                text NOT NULL DEFAULT 'applied' CHECK (stage IN (
                         'applied', 'shortlisted', 'screened', 'assignment', 'interviewing',
                         'offered', 'offer_accepted', 'joined',
                         'rejected', 'withdrawn', 'went_silent')),
  stage_entered_date   timestamptz,
  current_comp         integer,
  expected_comp        integer, -- captured at screen, not at offer (§5.4 comp rule)
  notice_period_days   integer,
  outcome_reason       text CHECK (outcome_reason IS NULL OR outcome_reason IN (
                         'experience_below_requirement', 'craft_below_bar', 'wrong_specialism',
                         'comp_expectation_above_band', 'notice_period_unworkable',
                         'location_or_mode_mismatch', 'communication_client_readiness',
                         'strong_candidate_role_closed', 'strong_candidate_better_fit_elsewhere',
                         'accepted_another_offer', 'counteroffer_from_current_employer',
                         'declined_on_compensation', 'declined_on_role_or_agency',
                         'declined_on_location_or_timing', 'withdrew_mid_process',
                         'went_silent', 'no_show', 'unreachable', 'accepted_then_did_not_join')),
  offer_amount         integer,
  offer_date           date,
  counter_offer_amount integer,
  joined_date          date,
  revisit              boolean NOT NULL DEFAULT false,
  revisit_after        date,
  question_answers     jsonb,
  -- Terminal stages require a structured outcome reason (§6.1, M4 enforces in UI too)
  CONSTRAINT application_terminal_requires_reason CHECK (
    stage NOT IN ('rejected', 'withdrawn', 'went_silent') OR outcome_reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_application_person ON application(person_id);
CREATE INDEX IF NOT EXISTS idx_application_campaign ON application(campaign_id);
CREATE INDEX IF NOT EXISTS idx_application_owner ON application(owner_staff_id);
CREATE INDEX IF NOT EXISTS idx_application_stage ON application(stage);

-- ---------------------------------------------------------------------------
-- §5.5 screen — the telephonic screening round, a first-class record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS screen (
  screen_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES application(application_id),
  conducted_by_staff_id uuid NOT NULL REFERENCES staff(staff_id),
  screen_datetime       timestamptz NOT NULL,
  outcome               text NOT NULL CHECK (outcome IN ('advance', 'reject', 'not_interested', 'unreachable')),
  qualifier_answers     jsonb,
  recruiter_verdict     text CHECK (recruiter_verdict IS NULL OR recruiter_verdict IN ('strong_yes', 'yes', 'no', 'strong_no')),
  notes                 text
);

CREATE INDEX IF NOT EXISTS idx_screen_application ON screen(application_id);
CREATE INDEX IF NOT EXISTS idx_screen_conducted_by ON screen(conducted_by_staff_id);

-- ---------------------------------------------------------------------------
-- §5.6 round — interview rounds, generic and unlimited
-- (interviewer_staff_ids is a uuid array; membership in staff is enforced at
--  the application layer since Postgres cannot FK array elements.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS round (
  round_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES application(application_id),
  round_number          integer NOT NULL,
  label                 text, -- decoration only, never used for logic or grouping
  interviewer_staff_ids uuid[] NOT NULL DEFAULT '{}',
  scheduled_datetime    timestamptz,
  mode                  text CHECK (mode IS NULL OR mode IN ('in_person', 'video', 'phone')),
  attendance            text CHECK (attendance IS NULL OR attendance IN (
                          'attended', 'candidate_no_show', 'rescheduled_by_us',
                          'rescheduled_by_candidate', 'cancelled')),
  scores                jsonb,
  verdict               text CHECK (verdict IS NULL OR verdict IN ('strong_yes', 'yes', 'no', 'strong_no')),
  notes                 text,
  entered_by_staff_id   uuid REFERENCES staff(staff_id),
  entered_date          timestamptz, -- distinct from scheduled_datetime; the gap is feedback lag (R4)
  UNIQUE (application_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_round_application ON round(application_id);

-- ---------------------------------------------------------------------------
-- §5.8 event — append-only activity log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event (
  event_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id      uuid NOT NULL REFERENCES person(person_id),
  application_id uuid REFERENCES application(application_id),
  type           text NOT NULL CHECK (type IN (
                   'application_received', 'outreach_attempted', 'contact_made',
                   'screen_conducted', 'round_scheduled', 'round_outcome_recorded',
                   'assignment_sent', 'assignment_received', 'offer_made',
                   'stage_changed', 'owner_changed', 'note_added', 'consent_withdrawn')),
  channel        text CHECK (channel IS NULL OR channel IN ('call', 'whatsapp', 'email', 'in_person', 'system')),
  timestamp      timestamptz NOT NULL DEFAULT now(),
  staff_id       uuid REFERENCES staff(staff_id),
  note           text
);

CREATE INDEX IF NOT EXISTS idx_event_person ON event(person_id);
CREATE INDEX IF NOT EXISTS idx_event_application ON event(application_id);
CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event(timestamp);

-- Never edited, never deleted (§5.8). Enforced in the database itself.
CREATE OR REPLACE FUNCTION forbid_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_append_only ON event;
CREATE TRIGGER event_append_only
  BEFORE UPDATE OR DELETE ON event
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();

-- ---------------------------------------------------------------------------
-- Session store (app server is stateless per §13.1; sessions live in Postgres)
-- Schema required by connect-pg-simple.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session (
  sid    varchar PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
