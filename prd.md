# Recruitment Operations Tool — Product Requirements Document

**Version:** 1.0 (v1 scope)
**Owner:** Talent Acquisition
**Status:** Approved for build
**Build method:** AI-assisted (Cursor), module-by-module

---

## How to use this document with Cursor

This PRD is written to be consumed by an AI coding assistant one module at a time.

- **Sections 1–7 are global context.** Keep them in context for every build session. They contain the data model, enumerations, and rules that every module depends on.
- **Section 8 contains the modules.** Build one module per session. Each module lists its dependencies, scope, acceptance criteria, and explicit out-of-scope items.
- **Section 3 (Non-Goals) is binding.** If a feature is listed as a non-goal, do not build it, do not scaffold for it, do not add fields "just in case." Scope discipline is the single biggest risk to this project.
- **Section 6 (Enumerations) should become a single constants file** in the codebase. Every dropdown in the application reads from it. No free-text where an enum exists.
- **Section 13 is the technical setup.** Read it alongside M0. It covers stack, environments, database branching, file storage and the deployment path. Several of its rules — particularly on file storage — cause silent data loss if ignored.

---

## 1. Problem Statement

Recruitment for the agency currently runs on spreadsheets. This produces four recurring failures:

1. **Lost candidate history.** The same person applies multiple times over 12–24 months. Prior interview feedback, prior rejection reasons, and prior compensation discussions are not retrievable. We re-evaluate people we have already evaluated.
2. **No visibility into where time goes.** Hiring feels slow, but we cannot say which stage the delay sits in, or whether the constraint is the recruitment team, candidate responsiveness, or department manager availability.
3. **No measure of screening quality.** Recruiters conduct telephonic screens and advance candidates to department managers. We have no data on how many advanced candidates clear the next round, so we cannot tell a well-run screen from a poorly-run one, and we cannot coach.
4. **Full dependency on external sourcing.** Every open role starts from zero. Applicants who were strong but arrived when no role was open are not recoverable.

**Volume context:** approximately 200–1,000 applications per month across all roles. Two-year projection is roughly 15,000 applications against roughly 11,000 unique people. This is a small-data problem. No search infrastructure, ranking algorithms, queueing systems, or machine learning are required or wanted.

---

## 2. Goals

**G1. Build a permanent, searchable database of everyone who has ever applied.**
Success measure: percentage of hires sourced from the existing database rather than fresh external sourcing. Target 10% in year one, 25–30% by year two.

**G2. Make the recruitment process measurable.**
Success measure: for any open role, we can state how many days were spent in each stage and what the drop-off reason was at each exit point.

**G3. Improve screening quality.**
Success measure: percentage of recruiter-advanced candidates who clear the first department round, tracked per recruiter, trending upward.

**G4. Reduce time to first response.**
Success measure: 90% of applications reviewed within 48 working hours.

**G5. Never lose interview feedback.**
Success measure: 100% of conducted interview rounds have a recorded verdict and named interviewer.

### Design principle

**If it is not critical, it is not built.** This tool exists to make the HR team's work easier and more visible. Any feature that adds a step to someone's day without directly serving a goal above is out of scope. When in doubt, leave it out — it can be added in v1.5 once real usage shows it is needed.

---

## 3. Non-Goals (v1)

These are deliberately excluded. Do not build, do not scaffold, do not add placeholder fields.

| Excluded | Reason | Revisit |
|---|---|---|
| Department manager logins / portal | Departments already carry a full load. This tool serves HR. | v2 |
| Interviewer logins | Recruiter enters feedback in v1. | v1.5 (no-login feedback link) |
| Requisition weighting / tiering | Too many variables. Raw counts are sufficient. | Later, if needed |
| 6-month retention tracking | Requires a maintenance action nobody owns yet. | With HRMS suite |
| WhatsApp templates / bulk outreach | Not a priority. | v1.5+ |
| Freelancer database and rate cards | Not a priority. | v2 |
| Offer letter generation, onboarding, payroll | Belongs to HRMS suite. | v2+ |
| AI resume parsing, scoring, ranking | Volume does not justify it. Adds false confidence. | Not planned |
| Video interviewing, calendar integration | Out of scope. Scheduling is recorded, not orchestrated. | v2 |
| Multi-level approval workflows | Adds friction, serves no goal. | Not planned |
| Mobile app | Apply page is mobile-first web. Internal tool is desktop. | Not planned |

---

## 4. Users and Permissions

Three login roles. A fourth user type exists as data only.

| Role | Who | Permissions |
|---|---|---|
| **Admin** | Head of Talent Acquisition | Everything. Manages staff list, campaigns, question bank, enumerations. Sees all dashboards and all candidate data. Reassigns ownership. |
| **Recruiter** | Senior and junior HR team members | Full read/write on all candidates and applications. Creates and edits campaigns. Records screens, rounds, feedback, offers. Sees own performance dashboard and team dashboard. Cannot manage staff list or edit enumerations. |
| **Partner** | Head of company / top management | **Full access, equivalent to Admin.** All candidate data, all applications, all feedback, all compensation figures, all dashboards. Additionally sees the Leadership Overview dashboard (§8, M8), which is exclusive to this role. |
| **Interviewer** *(no login)* | Department heads and senior managers who take interviews | Exists only as a record in the Staff table so they can be selected as an interviewer. No login, no access, no notifications, no responsibilities inside the tool. |

**Note on Admin and Partner:** these two roles carry identical data permissions. They remain separate roles in code for two reasons: the Partner sees an additional dashboard the Admin does not, and the event log must distinguish who took an action. Do not collapse them into one role.

**Note on terminology:** in this document, *recruiter* means a member of the HR/TA team who owns candidates and conducts telephonic screens. *Department manager* means a department head or senior manager who takes later interview rounds. These are distinct and must not be conflated in code, labels, or metrics.

---

## 5. Data Model

Eight entities. Field types are indicative; adapt to the chosen stack.

### 5.1 `person` — one record per human

The permanent asset. Nothing role-specific or campaign-specific lives here.

| Field | Type | Notes |
|---|---|---|
| `person_id` | uuid, PK | System-generated |
| `full_name` | string, required | |
| `phone` | string, required, indexed, unique | **Primary dedupe key.** Normalise to E.164 on write. |
| `alt_phone` | string, nullable | |
| `email` | string, nullable, indexed | Secondary dedupe key |
| `city` | string, nullable | |
| `portfolio_url` | string, nullable | |
| `linkedin_url` | string, nullable | |
| `tags` | array of enum, nullable | From controlled tag list. Admin-maintained. |
| `first_seen_date` | timestamp | Date of first application |
| `first_source` | enum, nullable | Source of first application |
| `consent_date` | timestamp | When consent was captured at apply |
| `do_not_contact` | boolean, default false | Set on request |
| `merged_into` | uuid, nullable, FK → person | Non-null means this record was merged away |

**Dedupe rule:** on application submit, normalise phone and look up. On match, attach the new application to the existing `person`. Do not create a second person record. Surface an "Applied before" flag to the recruiter with prior applications, prior interviewers, and prior feedback.

**Merge rule:** manual merge tool for cases the phone match misses (changed number). Merging sets `merged_into` on the losing record, repoints all applications and events to the surviving record, and never hard-deletes.

---

### 5.2 `campaign` — a role opening

| Field | Type | Notes |
|---|---|---|
| `campaign_id` | uuid, PK | |
| `role_title` | string, required | |
| `department` | string, required | |
| `positions_open` | integer, default 1 | |
| `salary_band_min` | integer, nullable | Displayed publicly on apply page |
| `salary_band_max` | integer, nullable | Displayed publicly on apply page |
| `status` | enum | `open` / `on_hold` / `closed` |
| `opened_date` | date | |
| `closed_date` | date, nullable | |
| `public_slug` | string, unique | Drives the public URL |
| `screening_qualifiers` | array of string, max 2 | Role-specific questions the recruiter must answer during the telephonic screen |
| `feedback_dimensions` | array of string, max 4 | Scored dimensions for interview rounds in this campaign. Configurable per campaign — "craft" is meaningless for a finance role. |
| `assignment_stage_enabled` | boolean, default false | Controls whether the Assignment stage appears for this campaign |

---

### 5.3 `campaign_question` — join between campaign and question bank

| Field | Type | Notes |
|---|---|---|
| `campaign_question_id` | uuid, PK | |
| `campaign_id` | uuid, FK | |
| `question_id` | uuid, FK | |
| `display_order` | integer | |
| `is_required` | boolean | |
| `is_knockout` | boolean, default false | Knockout answers **tag and triage only**. They never auto-reject. |

---

### 5.4 `application` — person + campaign

Where stage and outcome live. One person has many applications.

| Field | Type | Notes |
|---|---|---|
| `application_id` | uuid, PK | |
| `person_id` | uuid, FK | |
| `campaign_id` | uuid, FK | |
| `owner_staff_id` | uuid, FK → staff | The recruiter who owns this candidate. Reassignable. **Closures attribute to the owner at time of join.** |
| `applied_date` | timestamp | |
| `source` | enum | Derived from source variant link used |
| `stage` | enum | See §6.1 |
| `stage_entered_date` | timestamp | Updated on every stage change. Drives aging alerts and stage-duration metrics. |
| `current_comp` | integer, nullable | Captured at screen |
| `expected_comp` | integer, nullable | **Captured at screen, not at offer.** Critical. |
| `notice_period_days` | integer, nullable | Captured at screen |
| `outcome_reason` | enum, nullable | Required when stage is terminal. See §6.2 |
| `offer_amount` | integer, nullable | |
| `offer_date` | date, nullable | |
| `counter_offer_amount` | integer, nullable | |
| `joined_date` | date, nullable | |
| `revisit` | boolean, default false | Flags into the future talent pool |
| `revisit_after` | date, nullable | |
| `question_answers` | json | Answers to campaign questions |

**Ownership rule:** ownership is at the **application**, never the campaign. Multiple recruiters work the same opening simultaneously; the owner of the candidate who joins gets the closure. No splitting, no percentages. Ownership is reassignable via a single dropdown and every change writes an event.

**Comp rule:** `expected_comp` is captured during the telephonic screen. The gap between expectation-at-screen and offer-made is a leading indicator of wasted process. If this field is empty at the point of offer, that itself is a screening quality signal.

---

### 5.5 `screen` — the telephonic screening round

A first-class record, not a status flag. This exists because screens-per-day and screening precision are core metrics and neither is computable from a checkbox.

| Field | Type | Notes |
|---|---|---|
| `screen_id` | uuid, PK | |
| `application_id` | uuid, FK | |
| `conducted_by_staff_id` | uuid, FK → staff | |
| `screen_datetime` | timestamp | When the call happened |
| `outcome` | enum | `advance` / `reject` / `not_interested` / `unreachable` |
| `qualifier_answers` | json | Answers to `campaign.screening_qualifiers` |
| `recruiter_verdict` | enum | `strong_yes` / `yes` / `no` / `strong_no`. Compared later against department verdict to measure calibration. |
| `notes` | text | |

**Design intent:** the mandatory fields *are* the question list. Filling the scorecard is how the right questions get asked. A screen submitted with empty fields and a four-word note is visibly a poor screen without anyone needing to listen to the call.

Fields required to save a screen with outcome `advance`: `expected_comp`, `notice_period_days`, all `qualifier_answers`, `recruiter_verdict`, `notes` (minimum 100 characters).

---

### 5.6 `round` — interview rounds, generic and unlimited

| Field | Type | Notes |
|---|---|---|
| `round_id` | uuid, PK | |
| `application_id` | uuid, FK | |
| `round_number` | integer, auto-increment per application | Round 1, Round 2, Round 3… |
| `label` | string, nullable | Optional free text. May stay empty. Decoration only — never used for logic or grouping. |
| `interviewer_staff_ids` | array of uuid, FK → staff | **Dropdown from staff list. Never free text.** |
| `scheduled_datetime` | timestamp | |
| `mode` | enum | `in_person` / `video` / `phone` |
| `attendance` | enum | See §6.4 |
| `scores` | json | Up to 4 dimensions from `campaign.feedback_dimensions`, each 1–5 |
| `verdict` | enum | `strong_yes` / `yes` / `no` / `strong_no` |
| `notes` | text | |
| `entered_by_staff_id` | uuid, FK → staff | Who typed it in (recruiter in v1) |
| `entered_date` | timestamp | **Distinct from the date the interview happened.** Do not collapse these — the gap is the feedback lag metric. |

**Round naming rule:** rounds are numbered, not named. There is no fixed sequence and no fixed count. An accountant's Round 2 and an art director's Round 2 are the same object, which is what allows stage timings to be compared across unrelated roles.

---

### 5.7 `staff`

| Field | Type | Notes |
|---|---|---|
| `staff_id` | uuid, PK | |
| `name` | string | |
| `department` | string | |
| `system_role` | enum | `admin` / `recruiter` / `partner` / `interviewer_no_login` |
| `email` | string, nullable | Login identity for the first three roles only |
| `active` | boolean, default true | Deactivate rather than delete — preserves historical attribution |

---

### 5.8 `event` — append-only activity log

Never edited, never deleted. This is the outreach history, the audit trail, and the source of the candidate timeline.

| Field | Type | Notes |
|---|---|---|
| `event_id` | uuid, PK | |
| `person_id` | uuid, FK | |
| `application_id` | uuid, FK, nullable | |
| `type` | enum | See §6.6 |
| `channel` | enum, nullable | `call` / `whatsapp` / `email` / `in_person` / `system` |
| `timestamp` | timestamp | |
| `staff_id` | uuid, FK → staff | |
| `note` | text, nullable | |

**Critical:** most events are written automatically as a side effect of actions elsewhere in the system (stage change, screen saved, round created, owner changed). Only manual outreach requires the recruiter to type anything. Do not build a workflow that asks users to log events by hand for things the system already knows.

---

### 5.9 `question` — the question bank

| Field | Type | Notes |
|---|---|---|
| `question_id` | uuid, PK | |
| `text` | string | |
| `type` | enum | `short_text` / `long_text` / `select` / `multi_select` / `url` / `file` / `number` |
| `options` | array of string, nullable | For select and multi_select |
| `active` | boolean, default true | |

---

## 6. Enumerations

Implement as a single shared constants module. Every dropdown reads from here.

### 6.1 Application stages

Ordered. Stages are **skippable** — one list serves every role.

```
applied          # unreviewed, by definition — a candidate never remains here after review
shortlisted      # reviewed, worth calling, not yet called — the call queue
screened         # telephonic screen completed, advancing
assignment       # only if campaign.assignment_stage_enabled
interviewing     # one or more rounds scheduled or completed
offered          # offer extended
offer_accepted   # accepted, in notice period, not yet joined
joined           # started. Closures count here.
```

Terminal stages (sit outside the pipeline board, require `outcome_reason`):

```
rejected
withdrawn
went_silent
```

**Rules:**
- `applied` means *unreviewed*. Review moves the record to `shortlisted` or `rejected`. Nothing stays in `applied` after a recruiter has looked at it. This makes the "aged over 48 hours" metric automatic rather than something anyone maintains.
- `shortlisted` is where candidates quietly rot. It carries its own aging alert.
- `assignment` is skipped entirely for campaigns where it is disabled. Finance and HR roles pass from `screened` to `interviewing`.
- `joined` is deliberately named for the unambiguous event. "Hired" can mean offer signed or seat filled; one of our outcome reasons is literally "accepted then didn't join," so the stage must mean the latter.
- `offer_accepted` exists as its own stage because the notice period is a real drop-off window. If `offered` and `joined` sit adjacent, the four-week gap is invisible and nobody owns the candidate through it.

### 6.2 Outcome reasons

Every reason is tagged `ours` or `theirs`, so drop-off analysis separates "we said no" from "they left."

**Attributed to us (`ours`):**
```
experience_below_requirement
craft_below_bar
wrong_specialism
comp_expectation_above_band
notice_period_unworkable
location_or_mode_mismatch
communication_client_readiness
strong_candidate_role_closed          # talent pool
strong_candidate_better_fit_elsewhere # talent pool
```

**Attributed to them (`theirs`):**
```
accepted_another_offer
counteroffer_from_current_employer
declined_on_compensation
declined_on_role_or_agency
declined_on_location_or_timing
withdrew_mid_process
went_silent
no_show
unreachable
accepted_then_did_not_join
```

The two talent-pool reasons plus the `revisit` flag on `application` are the entire future talent pool. A filtered view over them is a small build in v1.5, and it will have months of real data waiting for it.

### 6.3 Screen outcomes
```
advance
reject
not_interested
unreachable
```

### 6.4 Round attendance
```
attended
candidate_no_show
rescheduled_by_us
rescheduled_by_candidate
cancelled
```

Four distinct no-show-adjacent states, not two. This is how we find out what share of "the candidate ghosted us" is actually our own rescheduling.

### 6.5 Verdicts
```
strong_yes
yes
no
strong_no
```

### 6.6 Event types
```
application_received
outreach_attempted
contact_made
screen_conducted
round_scheduled
round_outcome_recorded
assignment_sent
assignment_received
offer_made
stage_changed
owner_changed
note_added
consent_withdrawn
```

### 6.7 Sources
```
linkedin
instagram
referral
campus
job_board
website_direct
agency_database        # sourced from our own repository — tracks Goal G1
consultant
other
```

---

## 7. Cross-Cutting Rules

**R1. Capture before interface.** Every field in §5 ships in v1 even where the interface that uses it does not. Deferred features can be built later; historical data cannot be recovered retroactively. The event log in particular must be live from day one.

**R2. No free text where an enum exists.** Interviewer names, rejection reasons, sources, and stages are all controlled lists. Free text here destroys reporting within six months.

**R3. Nothing is hard-deleted.** Merges repoint, deactivations flag, terminal stages preserve. The only exception is a candidate data deletion request (§10).

**R4. Interview date and feedback entry date are always separate fields.** Everywhere. No exceptions.

**R5. Mobile-first for the public apply page, desktop-first for everything internal.** The apply page must complete in under two minutes on a phone.

**R6. No feature may add a step to a department manager's day.** They are not users of this system in v1.

---

## 8. Modules

Build in the order listed. Each module states its dependencies and can be developed as a discrete session.

---

### M0 — Foundation

**Depends on:** nothing
**Purpose:** schema, auth, staff management, shared constants.

**Scope**
- Full database schema per §5. All tables, all fields, all indexes.
- Constants module per §6, imported everywhere.
- Authentication for `admin`, `recruiter`, `partner`. Email + password is sufficient.
- Role-based access control per §4.
- Staff CRUD (Admin only): add, edit, deactivate. Deactivation preserves historical attribution.
- Event log write helper — a single function every other module calls.

**Acceptance criteria**
- All eight tables exist with correct relationships and constraints.
- A Recruiter login cannot reach staff management or enumeration editing, by URL or by API.
- Admin and Partner logins reach all candidate-level routes; the Leadership Overview route is reachable by Partner only.
- Deactivating a staff member removes them from interviewer dropdowns but leaves them visible on historical rounds.
- The event write helper is the only path by which events are created.

**Out of scope:** SSO, password reset flows beyond basic email, audit UI.

---

### M1 — Campaign setup and question bank

**Depends on:** M0
**Purpose:** define role openings and the questions their apply page asks.

**Scope**
- Question bank CRUD (Admin and Recruiter): text, type, options, active flag.
- Campaign CRUD: all fields per §5.2.
- Campaign question builder: select from bank, set order, required flag, knockout flag.
- Campaign feedback dimensions: up to four, free text labels, set at campaign creation.
- Campaign screening qualifiers: up to two.
- Source variant link generation: one public URL per source in §6.7, all resolving to the same apply page but stamping `source` on submission.

**Acceptance criteria**
- A campaign can be created in under three minutes by someone who has done it before.
- Editing a question in the bank does not alter answers already recorded against past applications.
- Each source variant produces a distinct URL and correctly stamps the source on the resulting application.
- Setting `assignment_stage_enabled` to false removes the Assignment stage from that campaign's pipeline board entirely.

**Out of scope:** job description authoring, publishing to external boards, approval flows.

---

### M2 — Public apply page

**Depends on:** M1
**Purpose:** capture applications. Universal layout, campaign-specific questions.

**Scope**
- Single universal page template. Layout, styling, and structure are identical for every campaign — only the questions, role title, and salary band change.
- Universal fields on every application: full name, phone, email, city, portfolio/link, plus the campaign's questions.
- Public display of: role title, department, salary band, the process steps, and expected timeline. This is a drop-off reduction measure, not decoration.
- Consent checkbox with explicit purpose statement. Writes `consent_date`.
- Phone normalisation to E.164 on submit.
- Dedupe on submit: phone match attaches the application to the existing `person`; no duplicate person record is created.
- Confirmation screen on submission.
- Writes `application_received` event.

**Acceptance criteria**
- Completable in under two minutes on a phone with a standard question set.
- Resume upload is optional; portfolio URL is available for every campaign.
- Submitting with a phone number already in the database creates a new `application` against the existing `person`, and does not create a second `person`.
- Knockout answers set a flag visible to the recruiter but never change the stage or reject the application.
- Page is fully usable at 360px width.

**Out of scope:** account creation, save-and-resume, application status portal for candidates, CAPTCHA beyond basic bot protection.

---

### M3 — Candidate repository

**Depends on:** M0, M2
**Purpose:** find anyone, see everything about them.

**Scope**
- Search across name, phone, email, tags, role applied for, and free text within round and screen notes.
- Person detail view with **timeline**: every application, event, screen, round, and note in one reverse-chronological column.
- "Applied before" flag surfaced prominently on any application where the person has prior applications, showing prior campaigns, prior interviewers, and prior verdicts.
- Tag management on person records.
- Manual merge tool: select two person records, choose survivor, repoint all applications and events, set `merged_into` on the loser.
- `do_not_contact` toggle.

**Acceptance criteria**
- Searching a phone number returns the person in under one second at 15,000 records.
- The timeline shows events from every module in correct chronological order.
- Merging two records loses no applications, no events, and no feedback.
- A recruiter opening a repeat applicant sees prior feedback without navigating away.

**Out of scope:** saved searches, talent pool views (v1.5), bulk actions, export beyond basic CSV.

---

### M4 — Pipeline board

**Depends on:** M1, M2
**Purpose:** move candidates through stages and surface what is stalling.

**Scope**
- Per-campaign board, columns per §6.1, terminal stages held in a separate collapsed section.
- Stage change updates `stage_entered_date` and writes a `stage_changed` event.
- Moving a candidate to any terminal stage requires selecting an `outcome_reason`. This is enforced, not optional.
- Aging alerts on the recruiter home screen:
  - Applications in `applied` for more than 48 working hours
  - Applications in `shortlisted` for more than 72 working hours
  - Any application whose `stage_entered_date` exceeds the stage threshold
- Owner reassignment dropdown, writing an `owner_changed` event.
- Assignment stage hidden when `assignment_stage_enabled` is false.

**Acceptance criteria**
- A candidate cannot reach a terminal stage without a structured outcome reason.
- Aging counts exclude weekends.
- The recruiter home screen shows aged items across all campaigns they own, not per-campaign.
- Reassigning ownership preserves all history and is visible on the timeline.

**Out of scope:** drag-and-drop across campaigns, custom per-campaign stage lists, automation rules.

---

### M5 — Screening module

**Depends on:** M4
**Purpose:** make the telephonic screen a measurable, quality-controlled event.

**Scope**
- Screen record form per §5.5, launched from a candidate on the board.
- Mandatory fields enforced when outcome is `advance`: expected comp, notice period, all campaign qualifiers, recruiter verdict, notes of at least 100 characters.
- Saving a screen with outcome `advance` moves the application to `screened` and writes a `screen_conducted` event.
- Other outcomes move to the appropriate terminal stage with reason.
- Screens-per-day counter visible to the recruiter on their own dashboard.

**Acceptance criteria**
- The form cannot be saved as `advance` with any mandatory field empty.
- `screen_datetime` defaults to now but is editable, for screens logged after the fact.
- A screen is always attributable to a named staff member.
- Multiple screens can exist on one application (re-screen after a gap) without overwriting the first.

**Out of scope:** call recording, dialer integration, call scheduling.

---

### M6 — Interview rounds and feedback

**Depends on:** M4
**Purpose:** record unlimited rounds with named interviewers and structured feedback.

**Scope**
- Add round to an application. `round_number` auto-increments. Optional label field, may be left empty.
- Interviewer selection from staff dropdown, multi-select. **No free text.**
- Scheduling fields: datetime, mode.
- Attendance recorded per §6.4.
- Feedback form: the campaign's configured dimensions scored 1–5, one verdict, one notes field. Nothing longer.
- `entered_by_staff_id` and `entered_date` recorded separately from `scheduled_datetime`.
- Round outcome writes `round_scheduled` and `round_outcome_recorded` events.

**Acceptance criteria**
- An application can hold any number of rounds with no fixed sequence.
- Feedback dimensions render from campaign config, not from a hardcoded list.
- Recording a `candidate_no_show` does not require feedback but does require saving the attendance state.
- Feedback lag (entered date minus scheduled date) is computable from stored data.

**Out of scope:** interviewer logins, no-login feedback links, calendar invites, availability matching, reminders to interviewers.

---

### M7 — Offer and outcome

**Depends on:** M4
**Purpose:** close the loop and capture why hires fail.

**Scope**
- Offer fields on the application: amount, date, counter-offer amount.
- Stage progression: `offered` → `offer_accepted` → `joined`.
- `joined_date` capture.
- Terminal outcomes with structured reasons per §6.2.
- `revisit` flag and `revisit_after` date, settable at any point.
- Comparison surfaced in the UI: `expected_comp` (from screen) against `offer_amount`, shown at the point of offer.

**Acceptance criteria**
- Every application reaching a terminal stage has an outcome reason.
- Closures attribute to `owner_staff_id` at the time `joined` is set.
- The expectation-versus-offer gap is visible to the recruiter before the offer is recorded, not after.
- `accepted_then_did_not_join` is selectable from `offer_accepted`.

**Out of scope:** offer letter generation, approval routing, document storage, onboarding.

---

### M8 — Dashboards

**Depends on:** all above
**Purpose:** answer the two questions this tool exists to answer.

Build last, but every field it reads has been captured since M0. Three dashboards: Recruiter, Team, and Leadership Overview.

**Recruiter dashboard (own data, visible to self and Admin)**

| Metric | Definition |
|---|---|
| Closures this month | Count of applications at `joined` where owner is this recruiter |
| Closures, rolling 3 months | Same, three-month window. **Present this more prominently than the monthly figure** — hiring closes in lumps and monthly numbers read as noise. |
| Screens conducted | Count of `screen` records, by day and by month |
| Screening precision | Of candidates advanced from screen, percentage clearing Round 1 |
| Applications aged >48h | Count in `applied` past threshold |
| Offer acceptance rate | Offers accepted / offers made |

**Team dashboard (Admin and Partner)**

| Metric | Definition |
|---|---|
| Time to first response | `applied_date` to first stage change out of `applied`, median and 90th percentile |
| Median days per stage | Per stage, across all closed applications |
| Stage conversion rates | Screen→interview, interview→offer, offer→join |
| Drop-off by stage, split `ours` vs `theirs` | From outcome reason attribution |
| Rejection reason breakdown for recruiter-advanced candidates | The diagnostic behind poor screening precision |
| Verdict agreement rate | `screen.recruiter_verdict` versus Round 1 `round.verdict`, per recruiter, over time |
| Source effectiveness | Applications and joins per source variant |
| Percentage of hires from `agency_database` source | Goal G1 measure |
| Feedback lag | `round.entered_date` minus `round.scheduled_datetime`, median |
| No-show breakdown | Candidate no-shows versus our reschedules |

**Leadership Overview dashboard (Partner only)**

A single screen answering "what is happening with hiring across the company right now." Designed to be read in two minutes without drilling in, though every figure links through to the underlying candidates.

*Current position*

| Panel | Content |
|---|---|
| Open positions | Total positions open, broken down by department. Count of open campaigns. |
| Active pipeline | Total candidates currently in non-terminal stages, shown as a funnel across the stages in §6.1 |
| Hires | Joined this month, this quarter, and year to date, against positions opened in the same period |
| Offers outstanding | Count at `offered` and at `offer_accepted`, with the `offer_accepted` group flagged by expected join date |

*Health signals*

| Panel | Content |
|---|---|
| Roles at risk | Campaigns open longest with the thinnest late-stage pipeline. Sorted by days open, showing candidate count at `interviewing` and beyond. This is the panel that should drive conversations. |
| Average time to hire | Median days from `applied_date` to `joined_date`, trended over the last six months |
| Offer acceptance rate | Company-wide, trended |
| Why we lose candidates | Terminal outcome reasons aggregated and split `ours` versus `theirs`, top five in each |

*Team and sourcing*

| Panel | Content |
|---|---|
| Recruiter closures | Rolling three-month closures per recruiter, alongside screens conducted and screening precision |
| Source mix | Applications and resulting joins by source, showing which channels actually convert rather than which produce volume |
| Hires from own database | Percentage of joins sourced `agency_database`. The Goal G1 measure, trended. |

Every panel links through to the filtered candidate list behind it. No panel is aggregate-only.

**Interpretation notes to include in the UI as help text:**

- Screening precision is only meaningful compared **within similar roles**, and against a recruiter's own trend. Screening for a senior creative director and for a junior account executive produce very different pass rates. Do not rank recruiters working different desks against each other on this number.
- Screens conducted and screening precision must be read **together**. High volume with low precision indicates rushed calls. Low volume with high precision may indicate over-conservative screening — advancing too few, which is invisible without the pairing.
- Verdict agreement is expected to be low for new recruiters and should climb over months. It is a coaching signal, not a performance score.

**Out of scope:** custom report builder, scheduled email reports, data export beyond CSV.

---

## 9. Adoption

The primary risk to this project is not the build. It is the shadow spreadsheet that a recruiter keeps running "just for my own tracking" in month two, which quietly restores every problem in §1.

Mitigations to build in:
- The apply page is the **only** intake route. Once live, no application arrives by any other path.
- Aging alerts on the recruiter home screen make the tool the place work starts each day, not a place to file work afterwards.
- Screen and round forms are short enough that logging in the tool is faster than maintaining a parallel sheet.

Mitigation outside the build: a defined cutover date after which the spreadsheets are archived read-only and deleted. Target 100% of applications flowing through the tool by week six.

---

## 10. Privacy, Consent and Retention

- **Consent** is captured at the apply page with an explicit purpose statement. Stored as `consent_date` on the person record.
- **Retention:** 24 months from `first_seen_date` or last activity, whichever is later. After that, records are flagged for review, not auto-deleted.
- **Deletion requests:** an Admin-only action that removes personal identifiers from the person record while preserving anonymised application and stage data for historical reporting. **The same operation must delete every associated file from Cloudinary** — resume, portfolio uploads, assignment submissions — using the stored `public_id` values. A deletion that leaves the resume in object storage has deleted nothing meaningful. This is a single atomic action, not two steps someone remembers to do in sequence. This is the only permitted deletion path.
- **`do_not_contact`** suppresses the person from all future outreach views without removing history.
- Access to candidate-level data is available to Admin, Partner and Recruiter roles. There is no aggregate-only tier in v1.

---

## 11. Phasing

**v1** — Modules M0 through M8 as specified above.

**v1.5** — Candidates for the next release, in rough priority order:
1. **Talent pool view** — a filtered view over `revisit`, `strong_candidate_role_closed`, and `strong_candidate_better_fit_elsewhere`, plus tag search. Small build; the data will already exist.
2. **No-login feedback link** — unique tokenised URL sent to an interviewer, no password, feedback submitted directly. Typically the single largest improvement to feedback quality and turnaround.
3. WhatsApp templates and outreach compose.
4. Saved searches and bulk actions.

**v2** — Department manager read-only views, freelancer database, offer letter generation, requisition weighting if the raw counts prove insufficient. Retention tracking arrives with the wider HRMS suite.

---

## 12. Open Items

| Item | Owner | Needed by |
|---|---|---|
| Baseline numbers from current spreadsheets: duplicate rate, no-show rate, current time to first response | TA | Before M8, to set targets |
| Sign-off on apply page visual treatment | Creative leadership | Before M2 |
| Tag list — initial controlled vocabulary for person tags | TA | Before M3 |
| Spreadsheet cutover date | TA | Before launch |

---

## 13. Technical Setup

Read alongside M0. Everything here should be settled before the first line of application code.

### 13.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Development | Cursor | This document is the reference context |
| Repository | GitHub | Single repo, `main` and `dev` branches |
| Database | Neon (Postgres) | External to the app host by design — see §13.3 |
| File storage | Cloudinary | Resumes, portfolio uploads, assignment submissions |
| Hosting (development) | Render, connected to GitHub `dev` | Free tier is acceptable here |
| Hosting (production) | Hostinger Cloud, connected to GitHub `main` | Node.js app deploy from GitHub |
| Domain | Hostinger | See §13.6 |

The application layer must remain **stateless**. Nothing that matters may be written to the app server's filesystem. Both Render and Hostinger app environments should be treated as disposable — anything written locally is lost on the next deploy or restart. All state lives in Neon or Cloudinary.

### 13.2 Environments

Two environments, two GitHub branches, two Neon branches.

| Environment | Git branch | Host | Neon branch | Data |
|---|---|---|---|---|
| Development | `dev` | Render | `dev` | Seed and test data only |
| Production | `main` | Hostinger Cloud | `main` | Real candidate data |

**Rules:**
- Migrations run against the Neon `dev` branch first, always. No schema change reaches `main` without having run on `dev`.
- The `dev` environment must never be pointed at the production Neon branch, not even temporarily for debugging. Candidate PII does not enter a development environment.
- Render's free tier spins a service down after roughly 15 minutes of inactivity, with a cold start of up to a minute on the next request. This is acceptable for development and unacceptable for production, which is why production is not on it.

### 13.3 Database

Neon holds all relational data per §5.

- **Region:** select the Neon region geographically nearest the user base rather than accepting the default. This affects apply-page responsiveness and is the simpler answer to any question about where candidate data is stored.
- **Connection:** pooled connection string, supplied via environment variable. Never committed to the repository.
- **Branching:** Neon database branches are used for environment separation as described in §13.2, not for feature work.
- **Backups:** confirm point-in-time restore is enabled on the production branch before launch. The candidate database is the asset this entire project exists to build; it is the one thing that cannot be rebuilt.
- Keeping the database on Neon rather than on the app host is deliberate. It is what makes the Render-to-Hostinger production move a configuration change rather than a migration.

### 13.4 File storage — Cloudinary

Uploaded files are candidate PII: resumes contain names, phone numbers, addresses and sometimes current compensation. They are not public assets and must not be handled like images on a marketing site.

**Upload configuration**
- Upload with `resource_type: raw` and `type: authenticated`. The authenticated delivery type is part of the URL structure, so an asset uploaded this way cannot later be exposed by a settings change.
- Uploads are signed server-side. No unsigned upload presets.
- Store the Cloudinary **`public_id`** in Postgres. **Never store the full delivery URL.** Signed URLs expire; storing the ID means access can be regenerated, delivery settings can change, and the storage provider can be replaced without a data migration.

**Delivery**
- Files are served exclusively through an authenticated backend route — for example `GET /api/files/:application_id/:file_key`. The route verifies the session and role, then streams the file from Cloudinary.
- The Cloudinary URL is never sent to the browser. There is no path by which an unauthenticated party can reach a candidate document.

**Known configuration trap**
Cloudinary blocks PDF and ZIP delivery by default on free accounts, returning HTTP 401 on the first attempt. The commonly published fix is to enable "Allow delivery of PDF and ZIP files" in Security settings. **Do not apply that fix as a default.** It makes stored documents publicly deliverable, which is the opposite of what this system requires. Use the authenticated delivery pattern above instead. Verify the authenticated-PDF path works end to end during M2, early enough to adjust.

**Deletion**
Per §10, a candidate deletion request must remove Cloudinary assets in the same operation that anonymises the person record, using the stored `public_id` values. Implement as one atomic action.

### 13.5 Configuration and secrets

All of the following are environment variables, set per environment in the host's dashboard, never committed:

```
DATABASE_URL
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
SESSION_SECRET
APP_BASE_URL
```

A `.env.example` file listing keys with empty values is committed. A `.env` file is never committed, and `.gitignore` must cover it from the first commit.

### 13.6 Domains and deployment path

- **Public apply page:** a candidate-facing subdomain, e.g. `careers.<domain>`. Candidates must never see a URL resembling an internal admin system, and this subdomain should be able to outlive any change of internal tooling.
- **Internal tool:** a separate subdomain, e.g. `hire.<domain>`.
- Both are served by the same application via different route groups. The separation is at the domain level for presentation and future flexibility, not at the codebase level.

**Production cutover:** connect the GitHub `main` branch to Hostinger Cloud, set the environment variables per §13.5, point the Neon connection string at the `main` database branch, and configure DNS. Because no state lives on the application server, this is a deployment and DNS exercise, not a data migration. Render remains connected to `dev` afterwards and continues to serve as the development environment.

### 13.7 Build sequence note

M0 must establish, before any feature work: the schema, the constants module from §6, the environment variable structure, the Cloudinary upload and delivery helpers, and the event log write helper. Feature modules consume these. Building M2's file upload before the Cloudinary helper exists will produce local filesystem writes that are silently lost on the first redeploy.
