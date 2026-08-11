-- Extend officer review campaigns to membership applications.
--
-- Enum values only. Postgres permits ALTER TYPE ... ADD VALUE inside a
-- transaction but forbids using the new value in that same transaction, so
-- everything that references these lands in the next migration.

BEGIN;

ALTER TYPE plugin_data.csf_review_period_kind ADD VALUE IF NOT EXISTS 'membership_applications';
ALTER TYPE plugin_data.csf_review_subject_kind ADD VALUE IF NOT EXISTS 'application';

COMMIT;
