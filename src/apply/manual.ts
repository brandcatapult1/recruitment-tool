/**
 * M4.5 — Manual candidate entry.
 *
 * Note: the repo's prd.md Section 8 predates M4.5 (it jumps from M4 to M5).
 * This module is intentional product scope, not out-of-scope drift from the
 * checked-in PRD copy.
 */
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { writeEvent } from '../events';
import { buildQuestionAnswers, type QuestionValues } from '../snapshots';
import { uploadCandidateFile, isCloudinaryConfigured } from '../files/cloudinary';
import { normalisePhone } from './phone';
import { findOrCreatePerson, type ApplyFiles, type ApplyResult } from './submit';
import { isApplyCity, SOURCES, type Source } from '../constants';
import { label } from '../labels';
import type { CampaignRow } from '../campaigns/repository';
import { getStaff } from '../staff/repository';

export interface ManualEntryFields {
  submissionId: string;
  fullName: string;
  phone: string;
  email: string;
  city: string;
  currentComp: string;
  notCurrentlyEmployed: boolean;
  earliestJoinDate: string;
  workLinks: string;
  source: string;
  referrerName: string;
  referrerStaffId: string;
  /** DPDP paper trail — why we hold this person's data without a consent click. */
  dataProvenance: string;
  answers: QuestionValues;
}

export async function submitManualApplication(
  campaign: CampaignRow,
  fields: ManualEntryFields,
  files: ApplyFiles,
  ownerStaffId: string
): Promise<ApplyResult> {
  const existingSubmission = await pool.query<{ application_id: string }>(
    'SELECT application_id FROM apply_submission WHERE submission_id = $1',
    [fields.submissionId]
  );
  if (existingSubmission.rows[0]) {
    return { kind: 'idempotent', applicationId: existingSubmission.rows[0].application_id };
  }

  const parsed = parseManualFields(fields);
  if ('error' in parsed) return { kind: 'invalid', error: parsed.error };

  if ((files.cv || files.portfolio) && !isCloudinaryConfigured()) {
    return {
      kind: 'invalid',
      error: 'File storage is not configured. Set the Cloudinary environment variables on the host.',
    };
  }

  if (parsed.referrerStaffId) {
    const staff = await getStaff(parsed.referrerStaffId);
    if (!staff || !staff.active) {
      return { kind: 'invalid', error: 'Pick a staff member from the list, or leave referrer staff blank.' };
    }
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
      source: parsed.source,
      setConsent: false,
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
          staffId: ownerStaffId,
          note: `Manual entry · already applied to this campaign · source: ${label('source', parsed.source)}. Original application, CV and answers were left unchanged.`,
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

    let cv: { publicId: string; originalFilename: string } | null = null;
    let portfolio: { publicId: string; originalFilename: string } | null = null;
    if (files.cv) {
      cv = await uploadCandidateFile(files.cv.buffer, files.cv.originalname);
    }
    if (files.portfolio) {
      portfolio = await uploadCandidateFile(files.portfolio.buffer, files.portfolio.originalname);
    }

    const snapshot = await buildQuestionAnswers(campaign.campaign_id, parsed.answers, client);
    const { rows } = await client.query<{ application_id: string }>(
      `INSERT INTO application (
         person_id, campaign_id, owner_staff_id, applied_date, source, stage, stage_entered_date,
         current_comp, not_currently_employed, earliest_join_date, work_links, question_answers,
         cv_public_id, cv_original_filename, portfolio_public_id, portfolio_original_filename,
         referrer_name, referrer_staff_id, entry_channel
       ) VALUES (
         $1,$2,$3,now(),$4,'applied',now(),
         $5,$6,$7,$8,$9,
         $10,$11,$12,$13,
         $14,$15,'manual'
       )
       RETURNING application_id`,
      [
        person.person_id,
        campaign.campaign_id,
        ownerStaffId,
        parsed.source,
        parsed.currentComp,
        parsed.notCurrentlyEmployed,
        parsed.earliestJoinDate,
        parsed.workLinks,
        snapshot,
        cv?.publicId ?? null,
        cv?.originalFilename ?? null,
        portfolio?.publicId ?? null,
        portfolio?.originalFilename ?? null,
        parsed.referrerName,
        parsed.referrerStaffId,
      ]
    );
    const applicationId = rows[0].application_id;

    const referrerBit = await formatReferrerNote(client, parsed.referrerName, parsed.referrerStaffId);
    await writeEvent(
      {
        personId: person.person_id,
        applicationId,
        type: 'application_received',
        channel: 'system',
        staffId: ownerStaffId,
        note: [
          'Manual entry',
          `source: ${label('source', parsed.source)}`,
          referrerBit,
          `How we got their details: ${parsed.dataProvenance}`,
        ]
          .filter(Boolean)
          .join(' · '),
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

function parseManualFields(fields: ManualEntryFields):
  | {
      fullName: string;
      email: string | null;
      city: string | null;
      currentComp: number | null;
      notCurrentlyEmployed: boolean;
      earliestJoinDate: string | null;
      workLinks: string[] | null;
      source: Source;
      referrerName: string | null;
      referrerStaffId: string | null;
      dataProvenance: string;
      answers: QuestionValues;
    }
  | { error: string } {
  const fullName = fields.fullName.trim();
  const emailRaw = fields.email.trim();
  const cityRaw = fields.city.trim();
  const provenance = fields.dataProvenance.trim();
  const sourceRaw = fields.source.trim();
  const referrerName = fields.referrerName.trim();
  const referrerStaffId = fields.referrerStaffId.trim() || null;
  const earliestRaw = fields.earliestJoinDate.trim();
  const notCurrentlyEmployed = fields.notCurrentlyEmployed;

  if (!fullName) return { error: 'Full name is required.' };
  if (!(SOURCES as readonly string[]).includes(sourceRaw)) {
    return { error: 'Select a source.' };
  }
  const source = sourceRaw as Source;
  if (!provenance) {
    return { error: 'Say how you got this candidate’s details (DPDP paper trail).' };
  }
  if (provenance.length > 500) {
    return { error: 'That provenance note must be 500 characters or fewer.' };
  }
  if (source === 'referral') {
    if (!referrerName) return { error: 'Referrer name is required when source is referral.' };
  } else if (referrerName || referrerStaffId) {
    return { error: 'Referrer fields are only used when source is referral.' };
  }

  if (emailRaw && !emailRaw.includes('@')) return { error: 'Enter a valid email, or leave it blank.' };
  if (cityRaw && !isApplyCity(cityRaw)) return { error: 'Pick a city from the list, or leave it blank.' };

  let currentComp: number | null = null;
  if (notCurrentlyEmployed) {
    currentComp = null;
  } else if (fields.currentComp.trim() !== '') {
    const n = Number(fields.currentComp);
    if (!Number.isFinite(n) || n < 0) return { error: 'Current CTC must be a non-negative number, or blank.' };
    currentComp = n;
  }

  const workLinks = fields.workLinks
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));

  return {
    fullName,
    email: emailRaw || null,
    city: cityRaw || null,
    currentComp,
    notCurrentlyEmployed,
    earliestJoinDate: earliestRaw || null,
    workLinks: workLinks.length ? workLinks : null,
    source,
    referrerName: source === 'referral' ? referrerName : null,
    referrerStaffId: source === 'referral' ? referrerStaffId : null,
    dataProvenance: provenance,
    answers: fields.answers,
  };
}

async function formatReferrerNote(
  client: PoolClient,
  referrerName: string | null,
  referrerStaffId: string | null
): Promise<string | null> {
  if (!referrerName && !referrerStaffId) return null;
  let staffName: string | null = null;
  if (referrerStaffId) {
    const { rows } = await client.query<{ name: string }>(
      'SELECT name FROM staff WHERE staff_id = $1',
      [referrerStaffId]
    );
    staffName = rows[0]?.name ?? null;
  }
  if (referrerName && staffName) return `referrer: ${referrerName} (staff: ${staffName})`;
  if (referrerName) return `referrer: ${referrerName}`;
  if (staffName) return `referrer staff: ${staffName}`;
  return null;
}
