import type { PoolClient } from 'pg';
import { pool } from './db/pool';
import { EVENT_TYPES, EVENT_CHANNELS, type EventType, type EventChannel } from './constants';

export interface EventInput {
  personId: string;
  applicationId?: string | null;
  type: EventType;
  channel?: EventChannel | null;
  staffId?: string | null;
  note?: string | null;
  /** Defaults to now. Pass explicitly for events logged after the fact. */
  timestamp?: Date;
}

/**
 * The event log write helper (PRD §8 M0). This function is the ONLY path by
 * which events are created — no other code may INSERT into the event table.
 * The table itself is append-only, enforced by a database trigger.
 *
 * Most events are written automatically as a side effect of actions elsewhere
 * (§5.8): callers in feature modules invoke this inside their own transaction
 * by passing their PoolClient, so the event commits or rolls back with the
 * action that caused it.
 */
export async function writeEvent(input: EventInput, client?: PoolClient): Promise<string> {
  if (!EVENT_TYPES.includes(input.type)) {
    throw new Error(`Unknown event type: ${input.type}`);
  }
  if (input.channel != null && !EVENT_CHANNELS.includes(input.channel)) {
    throw new Error(`Unknown event channel: ${input.channel}`);
  }

  const runner = client ?? pool;
  const { rows } = await runner.query<{ event_id: string }>(
    `INSERT INTO event (person_id, application_id, type, channel, timestamp, staff_id, note)
     VALUES ($1, $2, $3, $4, COALESCE($5, now()), $6, $7)
     RETURNING event_id`,
    [
      input.personId,
      input.applicationId ?? null,
      input.type,
      input.channel ?? null,
      input.timestamp ?? null,
      input.staffId ?? null,
      input.note ?? null,
    ]
  );
  return rows[0].event_id;
}
