-- Friendly, stable project URLs.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS slug text;

WITH bases AS (
  SELECT
    id,
    organization_id,
    created_at,
    CASE
      WHEN trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) <> ''
        THEN trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
      WHEN trim(both '-' from regexp_replace(lower(key), '[^a-z0-9]+', '-', 'g')) <> ''
        THEN trim(both '-' from regexp_replace(lower(key), '[^a-z0-9]+', '-', 'g'))
      ELSE 'project'
    END AS base_slug
  FROM projects
),
numbered AS (
  SELECT
    id,
    base_slug,
    row_number() OVER (
      PARTITION BY organization_id, base_slug
      ORDER BY created_at, id
    ) AS seq
  FROM bases
)
UPDATE projects p
SET slug = CASE
  WHEN n.seq = 1 THEN n.base_slug
  ELSE n.base_slug || '-' || n.seq::text
END
FROM numbered n
WHERE p.id = n.id
  AND (p.slug IS NULL OR btrim(p.slug) = '');

ALTER TABLE projects
  ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS projects_organization_slug_uidx
  ON projects (organization_id, slug);
