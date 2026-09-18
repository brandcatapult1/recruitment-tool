-- M4.5 Manual candidate entry.
-- Repo PRD Section 8 predates M4.5 (jumps M4 → M5); this module is in-scope
-- per product direction even though the checked-in PRD copy omits it.

ALTER TABLE application
  ADD COLUMN IF NOT EXISTS referrer_name text,
  ADD COLUMN IF NOT EXISTS referrer_staff_id uuid REFERENCES staff(staff_id),
  ADD COLUMN IF NOT EXISTS entry_channel text NOT NULL DEFAULT 'public_apply';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'application_entry_channel_check'
  ) THEN
    ALTER TABLE application
      ADD CONSTRAINT application_entry_channel_check
      CHECK (entry_channel IN ('public_apply', 'manual'));
  END IF;
END $$;

-- Referrer fields only make sense on referral-sourced applications.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'application_referrer_requires_referral'
  ) THEN
    ALTER TABLE application
      ADD CONSTRAINT application_referrer_requires_referral
      CHECK (
        (referrer_name IS NULL AND referrer_staff_id IS NULL)
        OR source = 'referral'
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_application_referrer_staff
  ON application (referrer_staff_id)
  WHERE referrer_staff_id IS NOT NULL;
