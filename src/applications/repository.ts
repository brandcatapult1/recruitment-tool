import { pool } from '../db/pool';
import {
  ALL_STAGES,
  LOGIN_ROLES,
  OUTCOME_REASON_LIST,
  STAGE_AGING_WEEKDAY_HOURS,
  isStage,
  isTerminalStage,
  type Stage,
} from '../constants';
import { UserFacingError } from '../http/errors';
import { writeEvent } from '../events';
import { label } from '../labels';
import { weekdayHoursBetween } from '../time/weekdays';
import { getStaff } from '../staff/repository';
import { hasAppliedBefore } from '../people/repository';

export interface BoardCard {
  application_id: string;
  person_id: string;
  full_name: string;
  do_not_contact: boolean;
  stage: Stage;
  stage_entered_date: Date | string | null;
  owner_staff_id: string | null;
  owner_name: string | null;
  source: string | null;
  referrer_name: string | null;
  referrer_staff_name: string | null;
  applied_date: Date | string | null;
  outcome_reason: string | null;
  application_count: number;
}

export interface AgedApplication {
  application_id: string;
  person_id: string;
  full_name: string;
  campaign_id: string;
  role_title: string;
  brand_name: string;
  stage: Stage;
  stage_entered_date: Date | string;
  weekdayHours: number;
  thresholdHours: number;
}

export async function listBoardCards(campaignId: string): Promise<BoardCard[]> {
  const { rows } = await pool.query<BoardCard>(
    `SELECT a.application_id, a.person_id, a.stage, a.stage_entered_date, a.owner_staff_id,
            a.source, a.referrer_name, a.applied_date, a.outcome_reason,
            p.full_name, p.do_not_contact,
            s.name AS owner_name,
            rs.name AS referrer_staff_name,
            (SELECT count(*)::int FROM application x WHERE x.person_id = a.person_id) AS application_count
       FROM application a
       JOIN person p ON p.person_id = a.person_id
       LEFT JOIN staff s ON s.staff_id = a.owner_staff_id
       LEFT JOIN staff rs ON rs.staff_id = a.referrer_staff_id
      WHERE a.campaign_id = $1
      ORDER BY a.applied_date ASC NULLS LAST, p.full_name ASC`,
    [campaignId]
  );
  return rows.map((row) => ({ ...row, stage: row.stage as Stage }));
}

export async function getCampaignApplication(
  campaignId: string,
  applicationId: string
): Promise<{
  application_id: string;
  person_id: string;
  campaign_id: string;
  stage: Stage;
  owner_staff_id: string | null;
} | null> {
  const { rows } = await pool.query<{
    application_id: string;
    person_id: string;
    campaign_id: string;
    stage: Stage;
    owner_staff_id: string | null;
  }>(
    `SELECT application_id, person_id, campaign_id, stage, owner_staff_id
       FROM application
      WHERE application_id = $1 AND campaign_id = $2`,
    [applicationId, campaignId]
  );
  return rows[0] ?? null;
}

export async function changeStage(
  campaignId: string,
  applicationId: string,
  nextStage: string,
  outcomeReason: string | null,
  staffId: string
): Promise<void> {
  if (!isStage(nextStage)) throw new UserFacingError('Select a valid stage.');
  const app = await getCampaignApplication(campaignId, applicationId);
  if (!app) throw new UserFacingError('Application not found on this campaign.');
  if (app.stage === nextStage) return;

  let reason: string | null = outcomeReason?.trim() || null;
  if (isTerminalStage(nextStage)) {
    if (!reason || !(OUTCOME_REASON_LIST as readonly string[]).includes(reason)) {
      throw new UserFacingError('Select an outcome reason before moving to a terminal stage.');
    }
  } else {
    reason = null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE application
          SET stage = $2, stage_entered_date = now(), outcome_reason = $3
        WHERE application_id = $1`,
      [applicationId, nextStage, reason]
    );
    await writeEvent(
      {
        personId: app.person_id,
        applicationId,
        type: 'stage_changed',
        channel: 'system',
        staffId,
        note: `${label('stage', app.stage)} → ${label('stage', nextStage)}${
          reason ? ` (${label('outcomeReason', reason)})` : ''
        }`,
      },
      client
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (isCheckViolation(err)) {
      throw new UserFacingError('Select an outcome reason before moving to a terminal stage.');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function changeOwner(
  campaignId: string,
  applicationId: string,
  ownerStaffId: string | null,
  staffId: string
): Promise<void> {
  const app = await getCampaignApplication(campaignId, applicationId);
  if (!app) throw new UserFacingError('Application not found on this campaign.');
  const next = ownerStaffId || null;
  if ((app.owner_staff_id ?? null) === next) return;

  let ownerName = 'Unassigned';
  if (next) {
    const owner = await getStaff(next);
    if (
      !owner ||
      !owner.active ||
      !(LOGIN_ROLES as readonly string[]).includes(owner.system_role)
    ) {
      throw new UserFacingError('Select a recruiter from the list.');
    }
    ownerName = owner.name;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE application SET owner_staff_id = $2 WHERE application_id = $1', [
      applicationId,
      next,
    ]);
    await writeEvent(
      {
        personId: app.person_id,
        applicationId,
        type: 'owner_changed',
        channel: 'system',
        staffId,
        note: `Owner → ${ownerName}`,
      },
      client
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listAgedForOwner(ownerStaffId: string): Promise<AgedApplication[]> {
  const { rows } = await pool.query<{
    application_id: string;
    person_id: string;
    full_name: string;
    campaign_id: string;
    role_title: string;
    brand_name: string;
    stage: Stage;
    stage_entered_date: Date | string;
  }>(
    `SELECT a.application_id, a.person_id, p.full_name, a.campaign_id,
            c.role_title, b.name AS brand_name, a.stage, a.stage_entered_date
       FROM application a
       JOIN person p ON p.person_id = a.person_id
       JOIN campaign c ON c.campaign_id = a.campaign_id
       JOIN brand b ON b.brand_id = c.brand_id
      WHERE a.owner_staff_id = $1
        AND a.stage = ANY($2::text[])
        AND a.stage_entered_date IS NOT NULL`,
    [ownerStaffId, ALL_STAGES.filter((s) => STAGE_AGING_WEEKDAY_HOURS[s] != null)]
  );

  const now = new Date();
  const aged: AgedApplication[] = [];
  for (const row of rows) {
    const threshold = STAGE_AGING_WEEKDAY_HOURS[row.stage];
    if (threshold == null) continue;
    const entered = toDate(row.stage_entered_date);
    if (!entered) continue;
    const hours = weekdayHoursBetween(entered, now);
    if (hours > threshold) {
      aged.push({
        ...row,
        stage_entered_date: entered,
        weekdayHours: hours,
        thresholdHours: threshold,
      });
    }
  }
  aged.sort((a, b) => b.weekdayHours - b.thresholdHours - (a.weekdayHours - a.thresholdHours));
  return aged;
}

export function cardAppliedBefore(card: BoardCard): boolean {
  return hasAppliedBefore(card.application_count);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isCheckViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23514';
}
