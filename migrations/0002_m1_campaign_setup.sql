-- M1 campaign setup and question bank.
-- 0001_init.sql already created campaign, campaign_question and question with
-- every field from §5.2, §5.3 and §5.9; this migration only adds the
-- constraints, defaults and indexes M1's behaviour depends on.
--
-- Idempotent like 0001: applied automatically on startup, safe on every boot.

-- A question may appear at most once in a given campaign's question set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_question_unique_pair'
  ) THEN
    ALTER TABLE campaign_question
      ADD CONSTRAINT campaign_question_unique_pair UNIQUE (campaign_id, question_id);
  END IF;
END $$;

-- select / multi_select questions are meaningless without options to choose
-- from, and a snapshot of an empty option list cannot be rendered later (R5).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'question_options_present'
  ) THEN
    ALTER TABLE question
      ADD CONSTRAINT question_options_present CHECK (
        type NOT IN ('select', 'multi_select')
        OR (options IS NOT NULL AND cardinality(options) > 0)
      );
  END IF;
END $$;

-- Campaign creation must be quick (M1 acceptance criteria): opening today is
-- the overwhelmingly common case, so it is the default rather than a field to
-- fill in.
ALTER TABLE campaign ALTER COLUMN opened_date SET DEFAULT CURRENT_DATE;

-- Campaign lists are filtered by status constantly.
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaign(status);

-- Supports "which campaigns use this question" on the question bank screen.
CREATE INDEX IF NOT EXISTS idx_campaign_question_question ON campaign_question(question_id);

-- Supports "how many recorded answers reference this question", which is read
-- from the stored snapshots in application.question_answers, never by joining
-- the live question bank (R5).
CREATE INDEX IF NOT EXISTS idx_application_question_answers
  ON application USING gin (question_answers);
