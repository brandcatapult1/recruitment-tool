import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { writeEvent } from '../events';
import { buildQuestionAnswers, type QuestionValues } from '../snapshots';
import { uploadCandidateFile, isCloudinaryConfigured } from '../files/cloudinary';
import { normalisePhone } from './phone';
import { FREE_TEXT_CHAR_LIMIT } from '../constants';
import type { CampaignRow } from '../campaigns/repository';
import type { Source } from '../constants';

export interface ApplyFiles {
  cv?: { buffer: Buffer; originalname: string } | null;
  portfolio?: { buffer: Buffer; originalname: string } | null;
}

export interface ApplyFields {
  submissionId: string;
  fullName: string;
  phone: string;
  email: string;
  city: string;
  currentComp: string;
  notCurrentlyEmployed: boolean;
  earliestJoinDate: string;
  yearsInDiscipline: string;
  motivation: string;
  workLinks: string;
  answers: QuestionValues;
}

export type ApplyResult =
  | { kind: 'created'; applicationId: string }
  | { kind: 'repeat'; applicationId: string }
  | { kind: 'idempotent'; applicationId: string }
  | { kind: 'honeypot' }
  | { kind: 'invalid'; error: string };

export async function submitApplication(
  campaign: CampaignRow,
  source: Source,
  fields: ApplyFields,
  files: ApplyFiles,
  honeypotValue: string
): Promise<ApplyResult> {
  if (honeypotValue.trim()) {
    await pool.query(
      `INSERT INTO honeypot_rejection (campaign_slug, source, payload) VALUES ($1, $2, $3)`,
      [campaign.public_slug, source, JSON.stringify(auditPayload(fields, files))]
    );
    return { kind: 'honeypot' };
  }

  const existingSubmission = await pool.query<{ application_id: string }>(
    'SELECT application_id FROM apply_submission WHERE submission_id = $1',
    [fields.submissionId]
  );
  if (existingSubmission.rows[0]) {
    return { kind: 'idempotent', applicationId: existingSubmission.rows[0].application_id };
  }

  const parsed = parseFields(fields);
  if ('error' in parsed) return { kind: 'invalid', error: parsed.error };
  if (!files.cv) return { kind: 'invalid', error: 'A CV is required.' };
  if (!isCloudinaryConfigured()) {
    return {
      kind: 'invalid',
      error: 'File storage is not configured. Set the Cloudinary environment variables on the host.',
    };
  }

  const phone = normalisePhone(fields.phone);
  if (!phone.stored) return { kind: 'invalid', error: 'Phone is required.' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const person = await findOrCreatePerson(client, {
      fullName: parsed.fullName,
      phone: phone.stored,
      phoneNeedsReview: phone.needsReview,
      email: parsed.email,
      city: parsed.city,
      source,
    });

    const existing = await client.query<{ application_id: string }>(
      'SELECT application_id FROM application WHERE person_id = $1 AND campaign_id = $2',
      [person.person_id, campaign.campaign_id]
    );
    if (existing.rows[0]) {
      const applicationId = existing.rows[0].application_id;
      await writeEvent(
        {
          personId: person.person_id,
          applicationId,
          type: 'application_received',
          channel: 'system',
          note: 'Applied again to this campaign. Original application, CV and answers were left unchanged.',
        },
        client
      );
      await client.query(
        'INSERT INTO apply_submission (submission_id, application_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [fields.submissionId, applicationId]
      );
      await client.query('COMMIT');
      return { kind: 'repeat', applicationId };
    }

    const cv = await uploadCandidateFile(files.cv.buffer, files.cv.originalname);
    let portfolio: { publicId: string; originalFilename: string } | null = null;
    if (files.portfolio) {
      portfolio = await uploadCandidateFile(files.portfolio.buffer, files.portfolio.originalname);
    }

    const snapshot = await buildQuestionAnswers(campaign.campaign_id, parsed.answers, client);
    const { rows } = await client.query<{ application_id: string }>(
      `INSERT INTO application (
         person_id, campaign_id, applied_date, source, stage, stage_entered_date,
         current_comp, not_currently_employed, earliest_join_date, years_in_discipline,
         motivation, work_links, question_answers,
         cv_public_id, cv_original_filename, portfolio_public_id, portfolio_original_filename
       ) VALUES ($1,$2,now(),$3,'applied',now(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING application_id`,
      [
        person.person_id,
        campaign.campaign_id,
        source,
        parsed.currentComp,
        parsed.notCurrentlyEmployed,
        parsed.earliestJoinDate,
        parsed.yearsInDiscipline,
        parsed.motivation,
        parsed.workLinks,
        snapshot,
        cv.publicId,
        cv.originalFilename,
        portfolio?.publicId ?? null,
        portfolio?.originalFilename ?? null,
      ]
    );
    const applicationId = rows[0].application_id;
    await writeEvent(
      {
        personId: person.person_id,
        applicationId,
        type: 'application_received',
        channel: 'system',
      },
      client
    );
    await client.query('INSERT INTO apply_submission (submission_id, application_id) VALUES ($1, $2)', [
      fields.submissionId,
      applicationId,
    ]);
    await client.query('COMMIT');
    return { kind: 'created', applicationId };
  } catch (err) {
    await client.query('ROLLBACK');
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';
    if (code === '23505') {
      const again = await pool.query<{ application_id: string }>(
        `SELECT a.application_id
           FROM application a
           JOIN person p ON p.person_id = a.person_id
          WHERE a.campaign_id = $1 AND p.phone = $2`,
        [campaign.campaign_id, phone.stored]
      );
      if (again.rows[0]) {
        return { kind: 'repeat', applicationId: again.rows[0].application_id };
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

function parseFields(fields: ApplyFields):
  | {
      fullName: string;
      email: string;
      city: string;
      currentComp: number | null;
      notCurrentlyEmployed: boolean;
      earliestJoinDate: string;
      yearsInDiscipline: number;
      motivation: string;
      workLinks: string[] | null;
      answers: QuestionValues;
    }
  | { error: string } {
  const fullName = fields.fullName.trim();
  const email = fields.email.trim();
  const city = fields.city.trim();
  const motivation = fields.motivation.trim();
  const earliestJoinDate = fields.earliestJoinDate.trim();
  const yearsInDiscipline = Number(fields.yearsInDiscipline);
  const notCurrentlyEmployed = fields.notCurrentlyEmployed;
  const currentComp = notCurrentlyEmployed ? null : Number(fields.currentComp);

  if (!fullName) return { error: 'Full name is required.' };
  if (!email || !email.includes('@')) return { error: 'A valid email is required.' };
  if (!city) return { error: 'Current city is required.' };
  if (!earliestJoinDate) return { error: 'Earliest joining date is required.' };
  if (!Number.isFinite(yearsInDiscipline) || yearsInDiscipline < 0) {
    return { error: 'Years of experience in this discipline is required.' };
  }
  if (!notCurrentlyEmployed && (!Number.isFinite(currentComp) || (currentComp as number) < 0)) {
    return { error: 'Current CTC is required, or tick “I am not currently employed”.' };
  }
  if (!motivation) return { error: 'Tell us why you want this role.' };
  if (motivation.length > FREE_TEXT_CHAR_LIMIT) {
    return { error: `That answer must be ${FREE_TEXT_CHAR_LIMIT} characters or fewer.` };
  }

  const workLinks = fields.workLinks
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));

  return {
    fullName,
    email,
    city,
    currentComp,
    notCurrentlyEmployed,
    earliestJoinDate,
    yearsInDiscipline,
    motivation,
    workLinks: workLinks.length ? workLinks : null,
    answers: fields.answers,
  };
}

async function findOrCreatePerson(
  client: PoolClient,
  input: {
    fullName: string;
    phone: string;
    phoneNeedsReview: boolean;
    email: string;
    city: string;
    source: Source;
  }
): Promise<{ person_id: string }> {
  const found = await client.query<{ person_id: string; merged_into: string | null }>(
    'SELECT person_id, merged_into FROM person WHERE phone = $1',
    [input.phone]
  );
  if (found.rows[0]) {
    let id = found.rows[0].person_id;
    let merged = found.rows[0].merged_into;
    while (merged) {
      const next = await client.query<{ person_id: string; merged_into: string | null }>(
        'SELECT person_id, merged_into FROM person WHERE person_id = $1',
        [merged]
      );
      if (!next.rows[0]) break;
      id = next.rows[0].person_id;
      merged = next.rows[0].merged_into;
    }
    await client.query(
      `UPDATE person
          SET email = COALESCE(email, $2),
              city = COALESCE(city, $3),
              consent_date = now()
        WHERE person_id = $1`,
      [id, input.email, input.city]
    );
    return { person_id: id };
  }

  try {
    const inserted = await client.query<{ person_id: string }>(
      `INSERT INTO person (
         full_name, phone, phone_needs_review, email, city,
         first_seen_date, first_source, consent_date
       ) VALUES ($1,$2,$3,$4,$5,now(),$6,now())
       RETURNING person_id`,
      [input.fullName, input.phone, input.phoneNeedsReview, input.email, input.city, input.source]
    );
    return inserted.rows[0];
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';
    if (code !== '23505') throw err;
    const retry = await client.query<{ person_id: string }>(
      'SELECT person_id FROM person WHERE phone = $1',
      [input.phone]
    );
    if (!retry.rows[0]) throw err;
    return retry.rows[0];
  }
}

function auditPayload(fields: ApplyFields, files: ApplyFiles): Record<string, unknown> {
  return {
    full_name: fields.fullName,
    phone: fields.phone,
    email: fields.email,
    city: fields.city,
    submission_id: fields.submissionId,
    cv_filename: files.cv?.originalname ?? null,
    portfolio_filename: files.portfolio?.originalname ?? null,
    work_links: fields.workLinks,
  };
}
