-- Remove process_description and expected_timeline from campaign.
-- Apply-page campaign content is job description, salary (if shown), and questions.
-- Idempotent. Do not edit 0001–0004.

ALTER TABLE campaign DROP COLUMN IF EXISTS process_description;
ALTER TABLE campaign DROP COLUMN IF EXISTS expected_timeline;
