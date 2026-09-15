-- M3: search indexes and allow merge to repoint event.person_id / application_id.
-- Events remain otherwise append-only. New file only.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_person_name_trgm ON person USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_person_email_trgm ON person USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_person_tags ON person USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_campaign_role_trgm ON campaign USING gin (role_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_screen_notes_trgm ON screen USING gin (notes gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_round_notes_trgm ON round USING gin (notes gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_person_merged_into ON person(merged_into);
CREATE INDEX IF NOT EXISTS idx_person_first_seen ON person(first_seen_date DESC);

CREATE OR REPLACE FUNCTION forbid_event_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'event is append-only: DELETE is not permitted';
  END IF;
  -- Merge may repoint person_id and application_id. Nothing else may change.
  IF NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.timestamp IS DISTINCT FROM OLD.timestamp
     OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
     OR NEW.note IS DISTINCT FROM OLD.note THEN
    RAISE EXCEPTION 'event is append-only: UPDATE is not permitted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
