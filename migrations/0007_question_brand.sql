-- Part A: brand-scope the question bank so a department never sees
-- another brand's questions. New file only. Do not edit 0001–0006.

ALTER TABLE question ADD COLUMN IF NOT EXISTS brand_id uuid;

UPDATE question
   SET brand_id = (SELECT brand_id FROM brand WHERE name = 'Brand Catapult')
 WHERE brand_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM question WHERE brand_id IS NULL) THEN
    RAISE EXCEPTION 'question backfill left null brand_id';
  END IF;
END $$;

ALTER TABLE question ALTER COLUMN brand_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_brand_fk') THEN
    ALTER TABLE question
      ADD CONSTRAINT question_brand_fk FOREIGN KEY (brand_id) REFERENCES brand(brand_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_brand_text_unique') THEN
    ALTER TABLE question
      ADD CONSTRAINT question_brand_text_unique UNIQUE (brand_id, text);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_question_brand ON question(brand_id);

-- Drop any attachments that crossed brands before this column existed.
DELETE FROM department_question dq
      USING department d, question q
      WHERE dq.department_id = d.department_id
        AND dq.question_id = q.question_id
        AND q.brand_id <> d.brand_id;

DELETE FROM campaign_question cq
      USING campaign c, question q
      WHERE cq.campaign_id = c.campaign_id
        AND cq.question_id = q.question_id
        AND q.brand_id <> c.brand_id;

