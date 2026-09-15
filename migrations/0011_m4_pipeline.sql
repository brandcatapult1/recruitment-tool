-- M4 pipeline board: indexes for per-campaign columns and owner aging.
-- New file only. Do not edit 0001–0010.

CREATE INDEX IF NOT EXISTS idx_application_campaign_stage
  ON application (campaign_id, stage);

CREATE INDEX IF NOT EXISTS idx_application_owner_stage_entered
  ON application (owner_staff_id, stage, stage_entered_date)
  WHERE owner_staff_id IS NOT NULL;
