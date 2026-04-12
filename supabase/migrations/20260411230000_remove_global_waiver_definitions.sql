-- Remove global waiver definitions feature
-- Projects MUST have custom waivers; there is no global fallback.

-- 1. Delete all global waiver definitions (cascading deletes handle related records)
DELETE FROM "public"."waiver_definitions"
WHERE "scope" = 'global';

-- 2. Update CHECK constraint on waiver_definitions to only allow 'project' scope
ALTER TABLE "public"."waiver_definitions"
DROP CONSTRAINT IF EXISTS "waiver_def_scope_project";

ALTER TABLE "public"."waiver_definitions"
ADD CONSTRAINT "waiver_def_scope_project" 
CHECK (("scope" = 'project'::"text")  AND ("project_id" IS NOT NULL));

-- 3. Update CHECK constraint on scope to only allow 'project'
ALTER TABLE "public"."waiver_definitions"
DROP CONSTRAINT IF EXISTS "waiver_definitions_scope_check";

ALTER TABLE "public"."waiver_definitions"
ADD CONSTRAINT "waiver_definitions_scope_check" 
CHECK (("scope" = 'project'::"text"));

-- 4. Update CHECK constraint on source to remove 'global_pdf'
ALTER TABLE "public"."waiver_definitions"
DROP CONSTRAINT IF EXISTS "waiver_definitions_source_check";

ALTER TABLE "public"."waiver_definitions"
ADD CONSTRAINT "waiver_definitions_source_check"
CHECK (("source" = ANY (ARRAY['project_pdf'::"text", 'rich_text'::"text"])));

-- 5. Update RLS policy to remove global scope check
DROP POLICY IF EXISTS "waiver_definitions_read_policy" ON "public"."waiver_definitions";

CREATE POLICY "waiver_definitions_read_policy" ON "public"."waiver_definitions" FOR SELECT 
USING (EXISTS ( SELECT 1
  FROM "public"."projects"
  WHERE ("projects"."id" = "waiver_definitions"."project_id")));

-- No changes needed to write policy as it already checks for 'project' scope

-- 6. Update views/functions that reference global scope
DROP VIEW IF EXISTS "public"."waiver_definition_signers_accessible" CASCADE;

CREATE VIEW "public"."waiver_definition_signers_accessible" AS
 SELECT "waiver_definition_signers"."id",
    "waiver_definition_signers"."waiver_definition_id",
    "waiver_definition_signers"."role_key",
    "waiver_definition_signers"."label",
    "waiver_definition_signers"."required",
    "waiver_definition_signers"."order_index",
    "waiver_definition_signers"."rules",
    "waiver_definition_signers"."created_at",
    "waiver_definition_signers"."updated_at"
  FROM ("public"."waiver_definition_signers"
  JOIN "public"."waiver_definitions" ON (("waiver_definitions"."id" = "waiver_definition_signers"."waiver_definition_id")))
  WHERE (EXISTS ( SELECT 1
        FROM "public"."projects"
        WHERE ("projects"."id" = "waiver_definitions"."project_id")));

DROP VIEW IF EXISTS "public"."waiver_definition_fields_accessible" CASCADE;

CREATE VIEW "public"."waiver_definition_fields_accessible" AS
 SELECT "waiver_definition_fields"."id",
    "waiver_definition_fields"."waiver_definition_id",
    "waiver_definition_fields"."field_key",
    "waiver_definition_fields"."field_type",
    "waiver_definition_fields"."label",
    "waiver_definition_fields"."required",
    "waiver_definition_fields"."source",
    "waiver_definition_fields"."pdf_field_name",
    "waiver_definition_fields"."page_index",
    "waiver_definition_fields"."rect",
    "waiver_definition_fields"."signer_role_key",
    "waiver_definition_fields"."meta",
    "waiver_definition_fields"."created_at",
    "waiver_definition_fields"."updated_at"
  FROM ("public"."waiver_definition_fields"
  JOIN "public"."waiver_definitions" ON (("waiver_definitions"."id" = "waiver_definition_fields"."waiver_definition_id")))
  WHERE (EXISTS ( SELECT 1
        FROM "public"."projects"
        WHERE ("projects"."id" = "waiver_definitions"."project_id")));
