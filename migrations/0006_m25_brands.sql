-- M2.5: brand entity, campaign/department brand_id, backfill to Brand Catapult.
-- New file only. Do not edit 0001–0005.

CREATE TABLE IF NOT EXISTS brand (
  brand_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL UNIQUE,
  logo_public_id   text,
  apply_page_title text NOT NULL,
  active           boolean NOT NULL DEFAULT true
);

INSERT INTO brand (name, apply_page_title) VALUES
  ('Brand Catapult', 'Brand Catapult'),
  ('The Lightscape Studio', 'The Lightscape Studio')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- department.brand_id — every existing department is Brand Catapult
-- ---------------------------------------------------------------------------
ALTER TABLE department ADD COLUMN IF NOT EXISTS brand_id uuid;

UPDATE department
   SET brand_id = (SELECT brand_id FROM brand WHERE name = 'Brand Catapult')
 WHERE brand_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM department WHERE brand_id IS NULL) THEN
    RAISE EXCEPTION 'department backfill left null brand_id';
  END IF;
END $$;

ALTER TABLE department ALTER COLUMN brand_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'department_brand_fk') THEN
    ALTER TABLE department
      ADD CONSTRAINT department_brand_fk FOREIGN KEY (brand_id) REFERENCES brand(brand_id);
  END IF;
END $$;

ALTER TABLE department DROP CONSTRAINT IF EXISTS department_name_key;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'department_brand_name_unique') THEN
    ALTER TABLE department
      ADD CONSTRAINT department_brand_name_unique UNIQUE (brand_id, name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_department_brand ON department(brand_id);

-- ---------------------------------------------------------------------------
-- campaign.brand_id — derive from the department (already Catapult after above)
-- ---------------------------------------------------------------------------
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS brand_id uuid;

UPDATE campaign c
   SET brand_id = d.brand_id
  FROM department d
 WHERE c.department_id = d.department_id
   AND c.brand_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM campaign WHERE brand_id IS NULL) THEN
    RAISE EXCEPTION 'campaign backfill left null brand_id';
  END IF;
END $$;

ALTER TABLE campaign ALTER COLUMN brand_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_brand_fk') THEN
    ALTER TABLE campaign
      ADD CONSTRAINT campaign_brand_fk FOREIGN KEY (brand_id) REFERENCES brand(brand_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaign_brand ON campaign(brand_id);

-- ---------------------------------------------------------------------------
-- A campaign's department must belong to the same brand (DB, not only UI)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION campaign_department_same_brand()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM department d
     WHERE d.department_id = NEW.department_id
       AND d.brand_id = NEW.brand_id
  ) THEN
    RAISE EXCEPTION 'department must belong to the campaign brand';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS campaign_department_same_brand ON campaign;
CREATE TRIGGER campaign_department_same_brand
  BEFORE INSERT OR UPDATE OF department_id, brand_id ON campaign
  FOR EACH ROW EXECUTE PROCEDURE campaign_department_same_brand();
