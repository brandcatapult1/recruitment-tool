-- Part B: seed department assessment sets. No per-campaign override.
-- Photography & Videography on Brand Catapult is deactivated, not deleted.
-- New file only. Do not edit 0001–0007.

INSERT INTO department (name, brand_id)
SELECT x.name, b.brand_id
  FROM brand b
  CROSS JOIN (VALUES
    ('Photography'),
    ('Videography / Cinematography'),
    ('Post-Production')
  ) AS x(name)
 WHERE b.name = 'The Lightscape Studio'
ON CONFLICT ON CONSTRAINT department_brand_name_unique DO NOTHING;

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
  'Brand Catapult',
  'Brand Managers',
  $q$Have you personally owned the client relationship, or supported someone who did?$q$,
  $q$What's the largest account (by scale or profile) you've handled directly?$q$,
  'Client handling',
  'Strategic thinking',
  'Communication',
  'Ownership & reliability'
),
(
  'Brand Catapult',
  'Strategy & Planning',
  $q$Walk me through a strategy you built end-to-end — what was yours vs the team's?$q$,
  $q$Have you presented strategy directly to a client or senior leadership?$q$,
  'Analytical rigour',
  'Creativity of thinking',
  'Communication & articulation',
  'Client-readiness'
),
(
  'Brand Catapult',
  'Creative & Copy',
  $q$Which formats do you write most confidently, and in which languages?$q$,
  $q$Have you taken a campaign from brief to final execution?$q$,
  'Craft & writing quality',
  'Conceptual thinking',
  'Range & versatility',
  'Collaboration'
),
(
  'Brand Catapult',
  'Design',
  $q$Which software do you work in daily?$q$,
  $q$Walk me through one project from brief to final — what was your role?$q$,
  'Craft & execution',
  'Conceptual thinking',
  'Versatility',
  'Collaboration'
),
(
  'Brand Catapult',
  'Video Editing',
  $q$Which editing software do you work in, and do you also shoot?$q$,
  $q$What formats have you delivered most — short-form, long-form, brand films?$q$,
  'Technical skill',
  'Storytelling & pacing',
  'Creative range',
  'Reliability & turnaround'
),
(
  'Brand Catapult',
  'Performance Marketing',
  $q$What's the highest monthly ad spend you've personally managed?$q$,
  $q$Which platforms and industries have you run campaigns for?$q$,
  'Platform expertise',
  'Analytical & data skill',
  'Strategic thinking',
  'Ownership of results'
),
(
  'Brand Catapult',
  'Technology & Web',
  $q$What have you built that's live in production — not course or personal projects?$q$,
  $q$Which part of the stack are you strongest in?$q$,
  'Technical ability',
  'Problem-solving',
  'Code quality & reliability',
  'Communication'
),
(
  'Brand Catapult',
  'Accounts & Finance',
  $q$Which areas have you handled independently — GST, TDS, payroll, reconciliation?$q$,
  $q$Which accounting software do you work in?$q$,
  'Technical accuracy',
  'Attention to detail',
  'Process discipline',
  'Communication'
),
(
  'Brand Catapult',
  'Human Resources',
  $q$Which HR areas have you owned end-to-end?$q$,
  $q$Have you worked in an advertising or creative agency before?$q$,
  'Domain knowledge',
  'Judgement & discretion',
  'Communication',
  'Ownership'
),
(
  'Brand Catapult',
  'Operations',
  $q$Which operational areas have you run — vendors, procurement, process, coordination?$q$,
  $q$What's the largest team or project you've coordinated across?$q$,
  'Organisation & follow-through',
  'Problem-solving',
  'Communication',
  'Reliability'
),
(
  'Brand Catapult',
  'Branding & Projects',
  $q$Have you managed a project's full lifecycle — planning through implementation — or coordination only?$q$,
  $q$Have you worked at a design studio or branding agency?$q$,
  'Project ownership',
  'Attention to detail',
  'Stakeholder management',
  'Reliability'
),
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

UPDATE department d
   SET screening_qualifiers = ARRAY[s.q1, s.q2],
       feedback_dimensions = ARRAY[s.d1, s.d2, s.d3, s.d4]
  FROM dept_assessment_seed s
  JOIN brand b ON b.name = s.brand_name
 WHERE d.brand_id = b.brand_id
   AND d.name = s.dept_name;

UPDATE department d
   SET active = false
  FROM brand b
 WHERE d.brand_id = b.brand_id
   AND b.name = 'Brand Catapult'
   AND d.name = 'Photography & Videography';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM department d
      JOIN brand b ON b.brand_id = d.brand_id
     WHERE b.name = 'Brand Catapult'
       AND d.name = 'Photography & Videography'
       AND d.active = false
  ) THEN
    RAISE EXCEPTION 'Brand Catapult Photography & Videography was not deactivated';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM department d
      JOIN brand b ON b.brand_id = d.brand_id
      JOIN dept_assessment_seed s
        ON s.brand_name = b.name AND s.dept_name = d.name
     WHERE d.screening_qualifiers IS NULL
        OR cardinality(d.screening_qualifiers) <> 2
        OR d.feedback_dimensions IS NULL
        OR cardinality(d.feedback_dimensions) <> 4
  ) THEN
    RAISE EXCEPTION 'department assessment seed did not apply to every listed department';
  END IF;
END $$;
