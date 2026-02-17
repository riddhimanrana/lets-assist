-- Add recurrence occurrence date key for idempotent recurring project generation
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS recurrence_occurrence_date DATE;

-- Guard against duplicate occurrences for the same recurring parent and date.
-- This is partial to avoid affecting non-recurring projects and legacy rows with NULL date keys.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_recurrence_parent_occurrence_date_unique
ON projects (recurrence_parent_id, recurrence_occurrence_date)
WHERE recurrence_parent_id IS NOT NULL
  AND recurrence_occurrence_date IS NOT NULL;
