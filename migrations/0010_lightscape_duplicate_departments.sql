-- Deactivate Lightscape near-duplicates left by the 0008 seed, then
-- prevent the same collision on later seeds.
-- New file only. Do not edit 0001–0008.

-- "Post-Production" and "Post Production" must compare equal.
-- "Videography / Cinematography" does not collapse to "Videography"
-- (the slash is kept); that pair is handled by name below.
CREATE OR REPLACE FUNCTION department_name_key(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT lower(regexp_replace(trim(raw), '[[:space:]-]+', ' ', 'g'));
$$;

DO $$
DECLARE
  r record;
  msg text := '';
BEGIN
  FOR r IN
    SELECT d.name,
           count(DISTINCT c.campaign_id) AS campaigns,
           count(DISTINCT a.application_id) AS applications
      FROM department d
      JOIN brand b ON b.brand_id = d.brand_id
      LEFT JOIN campaign c ON c.department_id = d.department_id
      LEFT JOIN application a ON a.campaign_id = c.campaign_id
     WHERE b.name = 'The Lightscape Studio'
       AND d.name IN ('Post Production', 'Videography')
     GROUP BY d.department_id, d.name
  LOOP
    IF r.campaigns > 0 OR r.applications > 0 THEN
      msg := msg || format(
        '%s has %s campaign(s) and %s application(s). ',
        r.name, r.campaigns, r.applications
      );
    END IF;
  END LOOP;

  IF msg <> '' THEN
    RAISE EXCEPTION
      'Refusing to deactivate Lightscape duplicates that have campaigns or applicants. %Keep the attached records; do not orphan them.',
      msg;
  END IF;
END $$;

UPDATE department d
   SET active = false
  FROM brand b
 WHERE d.brand_id = b.brand_id
   AND b.name = 'The Lightscape Studio'
   AND d.name IN ('Post Production', 'Videography');

-- One active department per brand per normalised name. Inactive rows stay
-- (R3) so a later seed cannot recreate "Post-Production" next to "Post Production".
CREATE UNIQUE INDEX IF NOT EXISTS department_brand_norm_name_active_unique
  ON department (brand_id, (department_name_key(name)))
  WHERE active;

-- Future seeds: if an active row already matches the normalised seed name,
-- apply copy there and rename to the canonical spelling. Never insert a twin.
CREATE TEMP TABLE dept_assessment_seed (
  brand_name text NOT NULL,
  dept_name  text NOT NULL,
  q1         text,
  q2         text,
  d1         text,
  d2         text,
  d3         text,
  d4         text
);

INSERT INTO dept_assessment_seed (brand_name, dept_name, q1, q2, d1, d2, d3, d4) VALUES
(
  'The Lightscape Studio',
  'Photography',
  $q$Do you own your camera and lighting kit?$q$,
  $q$Which genres do you shoot most — product, food, fashion, lifestyle?$q$,
  'Technical skill',
  'Creative eye',
  'On-set direction',
  'Reliability & professionalism'
),
(
  'The Lightscape Studio',
  'Videography / Cinematography',
  $q$Which camera systems do you shoot on, and do you own your kit?$q$,
  $q$What have you shot most — brand films, ads, events, documentary?$q$,
  'Technical skill',
  'Visual storytelling',
  'On-set craft',
  'Reliability & professionalism'
),
(
  'The Lightscape Studio',
  'Post-Production',
  $q$Which software do you work in, and what's your specialism — edit, colour, sound, VFX?$q$,
  $q$What formats have you delivered — brand films, ads, long-form?$q$,
  'Technical skill',
  'Creative craft',
  'Turnaround & reliability',
  'Collaboration'
);

INSERT INTO department (name, brand_id, screening_qualifiers, feedback_dimensions)
SELECT s.dept_name,
       b.brand_id,
       ARRAY[s.q1, s.q2],
       ARRAY[s.d1, s.d2, s.d3, s.d4]
  FROM dept_assessment_seed s
  JOIN brand b ON b.name = s.brand_name
 WHERE NOT EXISTS (
         SELECT 1 FROM department d
          WHERE d.brand_id = b.brand_id
            AND d.active
            AND department_name_key(d.name) = department_name_key(s.dept_name)
       );

UPDATE department d
   SET name = s.dept_name,
       screening_qualifiers = ARRAY[s.q1, s.q2],
       feedback_dimensions = ARRAY[s.d1, s.d2, s.d3, s.d4]
  FROM dept_assessment_seed s
  JOIN brand b ON b.name = s.brand_name
 WHERE d.brand_id = b.brand_id
   AND d.active
   AND department_name_key(d.name) = department_name_key(s.dept_name);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM department d
      JOIN brand b ON b.brand_id = d.brand_id
     WHERE b.name = 'The Lightscape Studio'
       AND d.name IN ('Post Production', 'Videography')
       AND d.active
  ) THEN
    RAISE EXCEPTION 'Lightscape Post Production / Videography duplicates are still active';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'department_brand_norm_name_active_unique'
  ) THEN
    RAISE EXCEPTION 'department normalised-name unique index is missing';
  END IF;
END $$;
