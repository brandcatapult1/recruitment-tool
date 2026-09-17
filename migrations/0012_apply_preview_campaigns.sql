-- Dev/preview seed: one OPEN campaign each for Brand Catapult and
-- The Lightscape Studio, with department + campaign apply questions so
-- all three tiers render on the public apply page. Idempotent.

-- ---------------------------------------------------------------------------
-- Brand Catapult · Design — department questions (structured)
-- ---------------------------------------------------------------------------
WITH brand_row AS (
  SELECT brand_id FROM brand WHERE name = 'Brand Catapult'
),
dept_row AS (
  SELECT d.department_id
    FROM department d
    JOIN brand_row b ON b.brand_id = d.brand_id
   WHERE d.name = 'Design' AND d.active
),
ins AS (
  INSERT INTO question (text, type, options, brand_id)
  SELECT s.text, s.type, s.options, b.brand_id
    FROM brand_row b
    CROSS JOIN (VALUES
      (
        'Which software do you work in?',
        'multi_select',
        ARRAY[
          'Adobe Photoshop',
          'Adobe Illustrator',
          'Adobe InDesign',
          'Other'
        ]::text[]
      ),
      (
        'Which kinds of design work have you done?',
        'multi_select',
        ARRAY[
          'Brand identity',
          'Packaging',
          'Social & digital',
          'Print & OOH',
          'Editorial & layout',
          'Presentation design',
          'UI & web',
          'Motion graphics',
          'Illustration',
          'Typography',
          'Other'
        ]::text[]
      ),
      (
        'Your design education background',
        'select',
        ARRAY[
          'Formal design degree',
          'Design diploma or certificate',
          'Self-taught',
          'Currently studying design',
          'Degree in another field, design experience on the job'
        ]::text[]
      )
    ) AS s(text, type, options)
  ON CONFLICT ON CONSTRAINT question_brand_text_unique DO UPDATE
    SET type = EXCLUDED.type,
        options = EXCLUDED.options,
        active = true
  RETURNING question_id, text
)
INSERT INTO department_question (department_id, question_id, display_order, is_required)
SELECT d.department_id, q.question_id, o.ord, true
  FROM dept_row d
  CROSS JOIN (VALUES
    ('Which software do you work in?', 1),
    ('Which kinds of design work have you done?', 2),
    ('Your design education background', 3)
  ) AS o(text, ord)
  -- Join the INSERT CTE, not question: WITH data-modifying CTEs share one
  -- snapshot and cannot see each other's table writes.
  JOIN ins q ON q.text = o.text
ON CONFLICT (department_id, question_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Brand Catapult · campaign-only questions
-- ---------------------------------------------------------------------------
WITH brand_row AS (
  SELECT brand_id FROM brand WHERE name = 'Brand Catapult'
)
INSERT INTO question (text, type, options, brand_id)
SELECT s.text, s.type, s.options, b.brand_id
  FROM brand_row b
  CROSS JOIN (VALUES
    (
      'Have you led brand-identity work for a premium or luxury client?',
      'select',
      ARRAY[
        'Yes, as lead designer',
        'Yes, as a contributor',
        'Not yet'
      ]::text[]
    ),
    (
      'Tell us about a packaging or identity system you are proud of — what was hard about it?',
      'long_text',
      NULL::text[]
    )
  ) AS s(text, type, options)
ON CONFLICT ON CONSTRAINT question_brand_text_unique DO UPDATE
  SET type = EXCLUDED.type,
      options = EXCLUDED.options,
      active = true;

-- ---------------------------------------------------------------------------
-- Brand Catapult · Senior Brand Designer (open)
-- ---------------------------------------------------------------------------
INSERT INTO campaign (
  role_title, brand_id, department_id, job_description, positions_open,
  salary_band_min, salary_band_max, show_salary_publicly,
  status, opened_date, closed_date, public_slug
)
SELECT
  'Senior Brand Designer',
  b.brand_id,
  d.department_id,
  $jd$
<h2>About the role</h2>
<p>We are looking for a <strong>Senior Brand Designer</strong> who can take a brand from brief to a coherent visual system — identity, packaging, and the everyday assets that keep it alive.</p>
<h2>What you will do</h2>
<ul>
  <li>Own identity and packaging systems for client brands, end to end</li>
  <li>Translate strategy into visual direction that holds across print and digital</li>
  <li>Art-direct juniors and freelancers when a project needs more hands</li>
  <li>Present work clearly to clients and partners</li>
</ul>
<h3>You will thrive here if</h3>
<ul>
  <li>You have shipped brand systems, not only one-off layouts</li>
  <li>You are fluent in the Adobe print-and-identity stack</li>
  <li>You care about typography, craft, and commercial usefulness equally</li>
</ul>
<p>This is a studio role with real ownership — not a production-only seat.</p>
$jd$,
  1,
  900000,
  1400000,
  true,
  'open',
  CURRENT_DATE,
  NULL,
  'senior-brand-designer-preview'
FROM brand b
JOIN department d ON d.brand_id = b.brand_id AND d.name = 'Design' AND d.active
WHERE b.name = 'Brand Catapult'
  AND NOT EXISTS (
    SELECT 1 FROM campaign c WHERE c.public_slug = 'senior-brand-designer-preview'
  );

UPDATE campaign c
   SET role_title = 'Senior Brand Designer',
       department_id = d.department_id,
       brand_id = b.brand_id,
       job_description = $jd$
<h2>About the role</h2>
<p>We are looking for a <strong>Senior Brand Designer</strong> who can take a brand from brief to a coherent visual system — identity, packaging, and the everyday assets that keep it alive.</p>
<h2>What you will do</h2>
<ul>
  <li>Own identity and packaging systems for client brands, end to end</li>
  <li>Translate strategy into visual direction that holds across print and digital</li>
  <li>Art-direct juniors and freelancers when a project needs more hands</li>
  <li>Present work clearly to clients and partners</li>
</ul>
<h3>You will thrive here if</h3>
<ul>
  <li>You have shipped brand systems, not only one-off layouts</li>
  <li>You are fluent in the Adobe print-and-identity stack</li>
  <li>You care about typography, craft, and commercial usefulness equally</li>
</ul>
<p>This is a studio role with real ownership — not a production-only seat.</p>
$jd$,
       status = 'open',
       closed_date = NULL,
       show_salary_publicly = true,
       salary_band_min = COALESCE(c.salary_band_min, 900000),
       salary_band_max = COALESCE(c.salary_band_max, 1400000),
       opened_date = COALESCE(c.opened_date, CURRENT_DATE)
  FROM brand b
  JOIN department d ON d.brand_id = b.brand_id AND d.name = 'Design' AND d.active
 WHERE b.name = 'Brand Catapult'
   AND c.public_slug = 'senior-brand-designer-preview';

INSERT INTO campaign_question (campaign_id, question_id, display_order, is_required, is_knockout)
SELECT c.campaign_id, q.question_id, o.ord, true, false
  FROM campaign c
  JOIN brand b ON b.brand_id = c.brand_id AND b.name = 'Brand Catapult'
  CROSS JOIN (VALUES
    ('Have you led brand-identity work for a premium or luxury client?', 1),
    ('Tell us about a packaging or identity system you are proud of — what was hard about it?', 2)
  ) AS o(text, ord)
  JOIN question q ON q.text = o.text AND q.brand_id = b.brand_id
 WHERE c.public_slug = 'senior-brand-designer-preview'
ON CONFLICT ON CONSTRAINT campaign_question_unique_pair DO NOTHING;

-- ---------------------------------------------------------------------------
-- The Lightscape Studio · Photography — department questions
-- ---------------------------------------------------------------------------
WITH brand_row AS (
  SELECT brand_id FROM brand WHERE name = 'The Lightscape Studio'
),
dept_row AS (
  SELECT d.department_id
    FROM department d
    JOIN brand_row b ON b.brand_id = d.brand_id
   WHERE d.name = 'Photography' AND d.active
),
ins AS (
  INSERT INTO question (text, type, options, brand_id)
  SELECT s.text, s.type, s.options, b.brand_id
    FROM brand_row b
    CROSS JOIN (VALUES
      (
        'Which disciplines do you shoot?',
        'multi_select',
        ARRAY[
          'Product & still life',
          'Food',
          'Fashion & portrait',
          'Lifestyle',
          'Architecture & interiors',
          'Events',
          'Documentary',
          'Corporate',
          'Aerial & drone',
          'Other'
        ]::text[]
      ),
      (
        'Have you shot for premium or luxury brands?',
        'select',
        ARRAY[
          'Yes, regularly',
          'Once or twice',
          'Not yet'
        ]::text[]
      ),
      (
        'Do you own your equipment?',
        'select',
        ARRAY[
          'Full kit',
          'Partial kit',
          'No, I work with studio equipment'
        ]::text[]
      )
    ) AS s(text, type, options)
  ON CONFLICT ON CONSTRAINT question_brand_text_unique DO UPDATE
    SET type = EXCLUDED.type,
        options = EXCLUDED.options,
        active = true
  RETURNING question_id, text
)
INSERT INTO department_question (department_id, question_id, display_order, is_required)
SELECT d.department_id, q.question_id, o.ord, true
  FROM dept_row d
  CROSS JOIN (VALUES
    ('Which disciplines do you shoot?', 1),
    ('Have you shot for premium or luxury brands?', 2),
    ('Do you own your equipment?', 3)
  ) AS o(text, ord)
  JOIN ins q ON q.text = o.text
ON CONFLICT (department_id, question_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Lightscape · campaign-only questions
-- ---------------------------------------------------------------------------
WITH brand_row AS (
  SELECT brand_id FROM brand WHERE name = 'The Lightscape Studio'
)
INSERT INTO question (text, type, options, brand_id)
SELECT s.text, s.type, s.options, b.brand_id
  FROM brand_row b
  CROSS JOIN (VALUES
    (
      'Are you comfortable shooting tethered in a controlled studio set?',
      'select',
      ARRAY[
        'Yes, regularly',
        'Occasionally',
        'Not yet'
      ]::text[]
    ),
    (
      'Describe a recent product or still-life shoot you owned — lighting, styling, and turnaround.',
      'long_text',
      NULL::text[]
    )
  ) AS s(text, type, options)
ON CONFLICT ON CONSTRAINT question_brand_text_unique DO UPDATE
  SET type = EXCLUDED.type,
      options = EXCLUDED.options,
      active = true;

-- ---------------------------------------------------------------------------
-- Lightscape · Product Photographer (open)
-- ---------------------------------------------------------------------------
INSERT INTO campaign (
  role_title, brand_id, department_id, job_description, positions_open,
  salary_band_min, salary_band_max, show_salary_publicly,
  status, opened_date, closed_date, public_slug
)
SELECT
  'Product Photographer',
  b.brand_id,
  d.department_id,
  $jd$
<h2>About the role</h2>
<p>The Lightscape Studio needs a <strong>Product Photographer</strong> who can build clean, commercial stills under lights — precise, patient, and fast enough for real client calendars.</p>
<h2>What you will do</h2>
<ul>
  <li>Photograph products and still life for brand and e-commerce briefs</li>
  <li>Shape lighting and set dressing with stylists and art directors</li>
  <li>Deliver consistent series that hold up across pack, site, and social</li>
  <li>Work tethered in studio and adapt on location when the brief asks</li>
</ul>
<h3>You will thrive here if</h3>
<ul>
  <li>You already shoot product or still life at a professional standard</li>
  <li>You can explain lighting choices without hand-waving</li>
  <li>You treat deadlines and file hygiene as part of craft</li>
</ul>
<p>Bring a tight portfolio. We care more about judgement under lights than gear lists.</p>
$jd$,
  1,
  700000,
  1100000,
  true,
  'open',
  CURRENT_DATE,
  NULL,
  'product-photographer-preview'
FROM brand b
JOIN department d ON d.brand_id = b.brand_id AND d.name = 'Photography' AND d.active
WHERE b.name = 'The Lightscape Studio'
  AND NOT EXISTS (
    SELECT 1 FROM campaign c WHERE c.public_slug = 'product-photographer-preview'
  );

UPDATE campaign
   SET role_title = 'Product Photographer',
       job_description = $jd$
<h2>About the role</h2>
<p>The Lightscape Studio needs a <strong>Product Photographer</strong> who can build clean, commercial stills under lights — precise, patient, and fast enough for real client calendars.</p>
<h2>What you will do</h2>
<ul>
  <li>Photograph products and still life for brand and e-commerce briefs</li>
  <li>Shape lighting and set dressing with stylists and art directors</li>
  <li>Deliver consistent series that hold up across pack, site, and social</li>
  <li>Work tethered in studio and adapt on location when the brief asks</li>
</ul>
<h3>You will thrive here if</h3>
<ul>
  <li>You already shoot product or still life at a professional standard</li>
  <li>You can explain lighting choices without hand-waving</li>
  <li>You treat deadlines and file hygiene as part of craft</li>
</ul>
<p>Bring a tight portfolio. We care more about judgement under lights than gear lists.</p>
$jd$,
       status = 'open',
       closed_date = NULL,
       show_salary_publicly = true,
       salary_band_min = COALESCE(salary_band_min, 700000),
       salary_band_max = COALESCE(salary_band_max, 1100000),
       opened_date = COALESCE(opened_date, CURRENT_DATE)
 WHERE public_slug = 'product-photographer-preview';

-- Keep Lightscape campaign on the Photography department if it drifted.
UPDATE campaign c
   SET department_id = d.department_id,
       brand_id = b.brand_id
  FROM brand b
  JOIN department d ON d.brand_id = b.brand_id AND d.name = 'Photography' AND d.active
 WHERE b.name = 'The Lightscape Studio'
   AND c.public_slug = 'product-photographer-preview';

INSERT INTO campaign_question (campaign_id, question_id, display_order, is_required, is_knockout)
SELECT c.campaign_id, q.question_id, o.ord, true, false
  FROM campaign c
  JOIN brand b ON b.brand_id = c.brand_id AND b.name = 'The Lightscape Studio'
  CROSS JOIN (VALUES
    ('Are you comfortable shooting tethered in a controlled studio set?', 1),
    ('Describe a recent product or still-life shoot you owned — lighting, styling, and turnaround.', 2)
  ) AS o(text, ord)
  JOIN question q ON q.text = o.text AND q.brand_id = b.brand_id
 WHERE c.public_slug = 'product-photographer-preview'
ON CONFLICT ON CONSTRAINT campaign_question_unique_pair DO NOTHING;

-- ---------------------------------------------------------------------------
-- Sanity: both preview campaigns must exist and be open
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM campaign WHERE public_slug = 'senior-brand-designer-preview' AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'Brand Catapult preview campaign missing or not open';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM campaign WHERE public_slug = 'product-photographer-preview' AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'Lightscape preview campaign missing or not open';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM campaign c
      JOIN department_question dq ON dq.department_id = c.department_id
     WHERE c.public_slug = 'senior-brand-designer-preview'
  ) THEN
    RAISE EXCEPTION 'Catapult preview campaign has no department questions';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM campaign c
      JOIN campaign_question cq ON cq.campaign_id = c.campaign_id
     WHERE c.public_slug = 'senior-brand-designer-preview'
  ) THEN
    RAISE EXCEPTION 'Catapult preview campaign has no campaign questions';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM campaign c
      JOIN department_question dq ON dq.department_id = c.department_id
     WHERE c.public_slug = 'product-photographer-preview'
  ) THEN
    RAISE EXCEPTION 'Lightscape preview campaign has no department questions';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM campaign c
      JOIN campaign_question cq ON cq.campaign_id = c.campaign_id
     WHERE c.public_slug = 'product-photographer-preview'
  ) THEN
    RAISE EXCEPTION 'Lightscape preview campaign has no campaign questions';
  END IF;
END $$;
