-- M1 revision: department is a maintained table (PRD §5.10).
-- Campaigns inherit apply questions, screening qualifiers and feedback
-- dimensions from their department. assignment_stage_enabled is removed.
-- Idempotent. Do not edit 0001 or 0002.

CREATE TABLE IF NOT EXISTS department (
  department_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL UNIQUE,
  screening_qualifiers text[] CHECK (screening_qualifiers IS NULL OR cardinality(screening_qualifiers) <= 2),
  feedback_dimensions  text[] CHECK (feedback_dimensions IS NULL OR cardinality(feedback_dimensions) <= 4),
  active               boolean NOT NULL DEFAULT true
);

INSERT INTO department (name) VALUES
  ('Brand Managers'),
  ('Strategy & Planning'),
  ('Creative & Copy'),
  ('Design'),
  ('Video Editing'),
  ('Performance Marketing'),
  ('Technology & Web'),
  ('Accounts & Finance'),
  ('Human Resources'),
  ('Operations'),
  ('Branding & Projects'),
  ('Photography & Videography')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS department_question (
  department_question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id          uuid NOT NULL REFERENCES department(department_id),
  question_id            uuid NOT NULL REFERENCES question(question_id),
  display_order          integer NOT NULL,
  is_required            boolean NOT NULL DEFAULT false,
  UNIQUE (department_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_department_question_department ON department_question(department_id);

ALTER TABLE campaign ADD COLUMN IF NOT EXISTS department_id uuid;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS job_description text;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS show_salary_publicly boolean NOT NULL DEFAULT true;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS process_description text;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS expected_timeline text;

-- Map existing free-text department names onto the seed list.
UPDATE campaign c
   SET department_id = d.department_id
  FROM department d
 WHERE c.department_id IS NULL
   AND lower(d.name) = lower(c.department);

-- Leftover names become extra department rows so the FK can be NOT NULL.
INSERT INTO department (name)
SELECT DISTINCT trim(c.department)
  FROM campaign c
 WHERE c.department_id IS NULL
   AND c.department IS NOT NULL
   AND trim(c.department) <> ''
ON CONFLICT (name) DO NOTHING;

UPDATE campaign c
   SET department_id = d.department_id
  FROM department d
 WHERE c.department_id IS NULL
   AND lower(d.name) = lower(trim(c.department));

-- Any remaining row (empty department string) lands on the first seed department.
UPDATE campaign
   SET department_id = (SELECT department_id FROM department ORDER BY name LIMIT 1)
 WHERE department_id IS NULL;

-- Lift per-campaign qualifiers/dimensions onto the department if it is still empty.
UPDATE department d
   SET screening_qualifiers = src.screening_qualifiers
  FROM (
    SELECT DISTINCT ON (department_id) department_id, screening_qualifiers
      FROM campaign
     WHERE screening_qualifiers IS NOT NULL AND cardinality(screening_qualifiers) > 0
     ORDER BY department_id, opened_date NULLS LAST
  ) src
 WHERE d.department_id = src.department_id
   AND (d.screening_qualifiers IS NULL OR cardinality(d.screening_qualifiers) = 0);

UPDATE department d
   SET feedback_dimensions = src.feedback_dimensions
  FROM (
    SELECT DISTINCT ON (department_id) department_id, feedback_dimensions
      FROM campaign
     WHERE feedback_dimensions IS NOT NULL AND cardinality(feedback_dimensions) > 0
     ORDER BY department_id, opened_date NULLS LAST
  ) src
 WHERE d.department_id = src.department_id
   AND (d.feedback_dimensions IS NULL OR cardinality(d.feedback_dimensions) = 0);

UPDATE campaign SET job_description = '(Add a job description)' WHERE job_description IS NULL OR job_description = '';
ALTER TABLE campaign ALTER COLUMN job_description SET NOT NULL;
ALTER TABLE campaign ALTER COLUMN department_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_department_fk') THEN
    ALTER TABLE campaign
      ADD CONSTRAINT campaign_department_fk FOREIGN KEY (department_id) REFERENCES department(department_id);
  END IF;
END $$;

ALTER TABLE campaign DROP COLUMN IF EXISTS assignment_stage_enabled;
ALTER TABLE campaign DROP COLUMN IF EXISTS screening_qualifiers;
ALTER TABLE campaign DROP COLUMN IF EXISTS feedback_dimensions;
ALTER TABLE campaign DROP COLUMN IF EXISTS department;

CREATE INDEX IF NOT EXISTS idx_campaign_department ON campaign(department_id);
