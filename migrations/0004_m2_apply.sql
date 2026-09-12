-- M2 public apply page: capture fields, one application per person per campaign,
-- idempotent submissions, honeypot audit log.

ALTER TABLE person ADD COLUMN IF NOT EXISTS phone_needs_review boolean NOT NULL DEFAULT false;

ALTER TABLE application ADD COLUMN IF NOT EXISTS years_in_discipline numeric;
ALTER TABLE application ADD COLUMN IF NOT EXISTS motivation text;
ALTER TABLE application ADD COLUMN IF NOT EXISTS earliest_join_date date;
ALTER TABLE application ADD COLUMN IF NOT EXISTS not_currently_employed boolean NOT NULL DEFAULT false;
ALTER TABLE application ADD COLUMN IF NOT EXISTS work_links text[];
ALTER TABLE application ADD COLUMN IF NOT EXISTS cv_public_id text;
ALTER TABLE application ADD COLUMN IF NOT EXISTS cv_original_filename text;
ALTER TABLE application ADD COLUMN IF NOT EXISTS portfolio_public_id text;
ALTER TABLE application ADD COLUMN IF NOT EXISTS portfolio_original_filename text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'application_person_campaign_unique'
  ) THEN
    ALTER TABLE application
      ADD CONSTRAINT application_person_campaign_unique UNIQUE (person_id, campaign_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS apply_submission (
  submission_id  uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES application(application_id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS honeypot_rejection (
  honeypot_rejection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  campaign_slug         text,
  source                text,
  payload               jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_honeypot_rejection_submitted ON honeypot_rejection(submitted_at);
