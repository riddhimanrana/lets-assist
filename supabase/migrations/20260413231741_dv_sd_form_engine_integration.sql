-- Migration: DVSD Form Engine Integration
-- Adds JSON schema support to forms and payload support to submissions.

-- 1. Update Forms Table
ALTER TABLE plugin_data.dv_sd_signup_forms
ADD COLUMN IF NOT EXISTS form_schema jsonb DEFAULT '{"version": 1, "sections": []}'::jsonb,
ADD COLUMN IF NOT EXISTS ui_schema jsonb DEFAULT '{"layout": "single-column"}'::jsonb;

-- 2. Update Submissions Table
ALTER TABLE plugin_data.dv_sd_signup_submissions
ADD COLUMN IF NOT EXISTS response_data jsonb DEFAULT '{}'::jsonb;

-- 3. Comments for Documentation
COMMENT ON COLUMN plugin_data.dv_sd_signup_forms.form_schema IS 'Strict FormSchema JSON from lib/forms/engine.ts';
COMMENT ON COLUMN plugin_data.dv_sd_signup_forms.ui_schema IS 'FormUISchema JSON for rendering hints';
COMMENT ON COLUMN plugin_data.dv_sd_signup_submissions.response_data IS 'Flattened JSON of all user responses mapped by field key';
