import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { PERSON_TAGS } from '../constants';
import { UserFacingError } from '../http/errors';
import { writeEvent } from '../events';
import { listStaffByIds } from '../staff/repository';

export interface PersonRow {
  person_id: string;
  full_name: string;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  city: string | null;
  portfolio_url: string | null;
  linkedin_url: string | null;
  tags: string[] | null;
  first_seen_date: string | null;
  first_source: string | null;
  consent_date: string | null;
  do_not_contact: boolean;
  merged_into: string | null;
  phone_needs_review: boolean;
  application_count: number;
}

export interface PersonApplication {
  application_id: string;
  campaign_id: string;
  role_title: string;
  brand_name: string;
  department_name: string;
  stage: string;
  source: string | null;
  applied_date: string | null;
  outcome_reason: string | null;
}

export interface TimelineItem {
  at: string;
  kind: string;
  title: string;
  detail: string | null;
  campaign: string | null;
  brand: string | null;
}

export async function searchPeople(query: string): Promise<PersonRow[]> {
  const q = query.trim();
  if (!q) {
    const { rows } = await pool.query<PersonRow>(
      `${PERSON_SELECT}
        FROM person p
       WHERE p.merged_into IS NULL
       ORDER BY p.first_seen_date DESC NULLS LAST, p.full_name ASC
       LIMIT 50`
    );
    return rows;
  }

  const like = `%${escapeLike(q)}%`;
  const { rows } = await pool.query<PersonRow>(
    `${PERSON_SELECT}
      FROM person p
     WHERE p.merged_into IS NULL
       AND (
         p.full_name ILIKE $1 ESCAPE '\\'
         OR p.phone ILIKE $1 ESCAPE '\\'
         OR COALESCE(p.email, '') ILIKE $1 ESCAPE '\\'
         OR COALESCE(p.city, '') ILIKE $1 ESCAPE '\\'
         OR EXISTS (
              SELECT 1 FROM unnest(COALESCE(p.tags, '{}')) t WHERE t ILIKE $1 ESCAPE '\\'
            )
         OR EXISTS (
              SELECT 1
                FROM application a
                JOIN campaign c ON c.campaign_id = a.campaign_id
               WHERE a.person_id = p.person_id
                 AND c.role_title ILIKE $1 ESCAPE '\\'
            )
         OR EXISTS (
              SELECT 1
                FROM application a
                JOIN screen s ON s.application_id = a.application_id
               WHERE a.person_id = p.person_id
                 AND COALESCE(s.notes, '') ILIKE $1 ESCAPE '\\'
            )
         OR EXISTS (
              SELECT 1
                FROM application a
                JOIN round r ON r.application_id = a.application_id
               WHERE a.person_id = p.person_id
                 AND COALESCE(r.notes, '') ILIKE $1 ESCAPE '\\'
            )
       )
     ORDER BY p.full_name ASC
     LIMIT 50`,
    [like]
  );
  return rows;
}

export async function getPerson(personId: string): Promise<PersonRow | null> {
  const { rows } = await pool.query<PersonRow>(
    `${PERSON_SELECT} FROM person p WHERE p.person_id = $1`,
    [personId]
  );
  return rows[0] ?? null;
}

export async function listPersonApplications(personId: string): Promise<PersonApplication[]> {
  const { rows } = await pool.query<PersonApplication>(
    `SELECT a.application_id, a.campaign_id, a.stage, a.source, a.applied_date, a.outcome_reason,
            c.role_title, b.name AS brand_name, d.name AS department_name
       FROM application a
       JOIN campaign c ON c.campaign_id = a.campaign_id
       JOIN brand b ON b.brand_id = c.brand_id
       JOIN department d ON d.department_id = c.department_id
      WHERE a.person_id = $1
      ORDER BY a.applied_date DESC NULLS LAST`,
    [personId]
  );
  return rows;
}

export async function listTimeline(personId: string): Promise<TimelineItem[]> {
  const { rows } = await pool.query<TimelineItem>(
    `SELECT e.timestamp::text AS at,
            e.type AS kind,
            e.type AS title,
            e.note AS detail,
            c.role_title AS campaign,
            b.name AS brand
       FROM event e
       LEFT JOIN application a ON a.application_id = e.application_id
       LEFT JOIN campaign c ON c.campaign_id = a.campaign_id
       LEFT JOIN brand b ON b.brand_id = c.brand_id
      WHERE e.person_id = $1
      ORDER BY e.timestamp DESC`,
    [personId]
  );
  return rows;
}

export async function priorInterviewSummaries(personId: string): Promise<
  { campaign: string; interviewers: string[]; verdicts: string[] }[]
> {
  const { rows } = await pool.query<{
    role_title: string;
    interviewer_staff_ids: string[] | null;
    verdict: string | null;
    recruiter_verdict: string | null;
  }>(
    `SELECT c.role_title,
            r.interviewer_staff_ids,
            r.verdict,
            s.recruiter_verdict
       FROM application a
       JOIN campaign c ON c.campaign_id = a.campaign_id
       LEFT JOIN round r ON r.application_id = a.application_id
       LEFT JOIN screen s ON s.application_id = a.application_id
      WHERE a.person_id = $1
      ORDER BY a.applied_date DESC NULLS LAST`,
    [personId]
  );

  const staffIds = rows.flatMap((r) => r.interviewer_staff_ids ?? []);
  const staff = await listStaffByIds(staffIds);
  const names = new Map(staff.map((s) => [s.staff_id, s.name]));

  const byCampaign = new Map<string, { campaign: string; interviewers: Set<string>; verdicts: Set<string> }>();
  for (const row of rows) {
    let entry = byCampaign.get(row.role_title);
    if (!entry) {
      entry = { campaign: row.role_title, interviewers: new Set(), verdicts: new Set() };
      byCampaign.set(row.role_title, entry);
    }
    for (const id of row.interviewer_staff_ids ?? []) {
      const name = names.get(id);
      if (name) entry.interviewers.add(name);
    }
    if (row.verdict) entry.verdicts.add(row.verdict);
    if (row.recruiter_verdict) entry.verdicts.add(row.recruiter_verdict);
  }
  return [...byCampaign.values()].map((e) => ({
    campaign: e.campaign,
    interviewers: [...e.interviewers],
    verdicts: [...e.verdicts],
  }));
}

export async function setDoNotContact(personId: string, value: boolean): Promise<void> {
  const { rowCount } = await pool.query('UPDATE person SET do_not_contact = $2 WHERE person_id = $1', [
    personId,
    value,
  ]);
  if (!rowCount) throw new UserFacingError('Person not found.');
}

export async function setPersonTags(personId: string, tags: string[]): Promise<void> {
  const allowed = new Set(PERSON_TAGS as readonly string[]);
  for (const tag of tags) {
    if (!allowed.has(tag)) throw new UserFacingError('Choose tags from the list.');
  }
  await pool.query('UPDATE person SET tags = $2 WHERE person_id = $1', [
    personId,
    tags.length ? tags : null,
  ]);
}

export async function mergePeople(
  survivorId: string,
  loserId: string,
  staffId: string
): Promise<void> {
  if (survivorId === loserId) throw new UserFacingError('Select two different records.');
  const survivor = await getPerson(survivorId);
  const loser = await getPerson(loserId);
  if (!survivor || !loser) throw new UserFacingError('Person not found.');
  if (survivor.merged_into || loser.merged_into) {
    throw new UserFacingError('One of these records has already been merged.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await mergeInTransaction(client, survivor, loser, staffId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function mergeInTransaction(
  client: PoolClient,
  survivor: PersonRow,
  loser: PersonRow,
  staffId: string
): Promise<void> {
  const survivorApps = await client.query<{ application_id: string; campaign_id: string }>(
    'SELECT application_id, campaign_id FROM application WHERE person_id = $1',
    [survivor.person_id]
  );
  const loserApps = await client.query<{ application_id: string; campaign_id: string }>(
    'SELECT application_id, campaign_id FROM application WHERE person_id = $1',
    [loser.person_id]
  );
  const survivorByCampaign = new Map(survivorApps.rows.map((r) => [r.campaign_id, r.application_id]));

  for (const app of loserApps.rows) {
    const keepId = survivorByCampaign.get(app.campaign_id);
    if (!keepId) {
      await client.query('UPDATE application SET person_id = $1 WHERE application_id = $2', [
        survivor.person_id,
        app.application_id,
      ]);
      continue;
    }
    await client.query('UPDATE event SET application_id = $1, person_id = $2 WHERE application_id = $3', [
      keepId,
      survivor.person_id,
      app.application_id,
    ]);
    await client.query('UPDATE screen SET application_id = $1 WHERE application_id = $2', [
      keepId,
      app.application_id,
    ]);
    const { rows: maxRows } = await client.query<{ n: string }>(
      'SELECT COALESCE(MAX(round_number), 0) AS n FROM round WHERE application_id = $1',
      [keepId]
    );
    const offset = Number(maxRows[0].n);
    await client.query('UPDATE round SET round_number = round_number + $2 WHERE application_id = $1', [
      app.application_id,
      offset,
    ]);
    await client.query('UPDATE round SET application_id = $1 WHERE application_id = $2', [
      keepId,
      app.application_id,
    ]);
  }

  await client.query('UPDATE event SET person_id = $1 WHERE person_id = $2', [
    survivor.person_id,
    loser.person_id,
  ]);
  await client.query('UPDATE person SET merged_into = $1 WHERE person_id = $2', [
    survivor.person_id,
    loser.person_id,
  ]);
  await writeEvent(
    {
      personId: survivor.person_id,
      type: 'note_added',
      channel: 'system',
      staffId,
      note: `Merged ${loser.full_name} (${loser.phone}) into this record.`,
    },
    client
  );
}

const PERSON_SELECT = `
  SELECT p.*,
         (SELECT count(*)::int FROM application a WHERE a.person_id = p.person_id) AS application_count
`;

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
