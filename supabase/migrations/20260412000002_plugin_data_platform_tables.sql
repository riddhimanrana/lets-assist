-- Migration: Platform tables in plugin_data schema
-- These are shared infrastructure tables that ANY plugin can use.

-- ============================================================
-- 1. Organization Seasons
-- ============================================================

CREATE TABLE plugin_data.org_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label text NOT NULL,                    -- e.g. '2026-2027'
  starts_at date NOT NULL,
  ends_at date NOT NULL,
  is_current boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, label),
  CHECK (starts_at < ends_at)
);

CREATE INDEX idx_org_seasons_org ON plugin_data.org_seasons(organization_id);
CREATE INDEX idx_org_seasons_current ON plugin_data.org_seasons(organization_id) WHERE is_current = true;

COMMENT ON TABLE plugin_data.org_seasons IS 'Academic/fiscal year seasons scoped to an organization.';

-- Ensure only one current season per org
CREATE UNIQUE INDEX uq_org_seasons_one_current
  ON plugin_data.org_seasons(organization_id)
  WHERE is_current = true;

-- ============================================================
-- 2. Organization Member Profiles (plugin-scoped extensions)
-- ============================================================

CREATE TABLE plugin_data.org_member_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plugin_key text NOT NULL,               -- Which plugin owns this profile extension
  profile_data jsonb DEFAULT '{}',        -- Plugin-specific profile fields
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, user_id, plugin_key)
);

CREATE INDEX idx_org_member_profiles_org ON plugin_data.org_member_profiles(organization_id);
CREATE INDEX idx_org_member_profiles_user ON plugin_data.org_member_profiles(user_id);

COMMENT ON TABLE plugin_data.org_member_profiles IS 'Plugin-scoped profile extensions for org members. Each plugin can store its own member data.';

-- ============================================================
-- 3. Dynamic Form Definitions
-- ============================================================

CREATE TYPE plugin_data.form_status AS ENUM ('draft', 'active', 'closed', 'archived');

CREATE TABLE plugin_data.org_form_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plugin_key text,                        -- NULL = org-level form, set = plugin-owned
  season_id uuid REFERENCES plugin_data.org_seasons(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  form_schema jsonb NOT NULL,             -- JSON Schema defining the form fields
  ui_schema jsonb DEFAULT '{}',           -- UI hints (field ordering, sections, conditional logic)
  status plugin_data.form_status DEFAULT 'draft',
  requires_payment boolean DEFAULT false,
  payment_amount_cents integer,           -- Amount in cents if requires_payment
  payment_currency text DEFAULT 'usd',
  max_submissions integer,                -- NULL = unlimited
  opens_at timestamptz,
  closes_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_org_form_defs_org ON plugin_data.org_form_definitions(organization_id);
CREATE INDEX idx_org_form_defs_status ON plugin_data.org_form_definitions(organization_id, status);
CREATE INDEX idx_org_form_defs_plugin ON plugin_data.org_form_definitions(organization_id, plugin_key);

COMMENT ON TABLE plugin_data.org_form_definitions IS 'Dynamic form definitions using JSON Schema. Used for membership forms, tournament signups, etc.';

-- ============================================================
-- 4. Form Submissions
-- ============================================================

CREATE TYPE plugin_data.submission_status AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

CREATE TABLE plugin_data.org_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES plugin_data.org_form_definitions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submission_data jsonb NOT NULL,         -- The actual form responses
  status plugin_data.submission_status DEFAULT 'pending',
  payment_intent_id text,                 -- Stripe payment intent if payment was required
  payment_status text,                    -- pending, succeeded, failed
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  submitted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_org_form_subs_form ON plugin_data.org_form_submissions(form_id);
CREATE INDEX idx_org_form_subs_org ON plugin_data.org_form_submissions(organization_id);
CREATE INDEX idx_org_form_subs_user ON plugin_data.org_form_submissions(user_id);
CREATE INDEX idx_org_form_subs_status ON plugin_data.org_form_submissions(form_id, status);

COMMENT ON TABLE plugin_data.org_form_submissions IS 'Submissions against dynamic form definitions.';

-- ============================================================
-- 5. AI Usage Log (for billing attribution)
-- ============================================================

CREATE TABLE plugin_data.ai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  plugin_key text,
  gateway_scope text NOT NULL,            -- 'moderation', 'platform', 'plugin'
  model_id text NOT NULL,                 -- e.g. 'anthropic/claude-sonnet-4.6'
  feature text,                           -- e.g. 'judge-optimizer', 'content-moderation'
  input_tokens integer DEFAULT 0,
  output_tokens integer DEFAULT 0,
  total_tokens integer GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  estimated_cost_usd numeric(10, 6),      -- Pre-calculated cost if available
  latency_ms integer,
  success boolean DEFAULT true,
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_ai_usage_org ON plugin_data.ai_usage_log(organization_id);
CREATE INDEX idx_ai_usage_plugin ON plugin_data.ai_usage_log(plugin_key);
CREATE INDEX idx_ai_usage_scope ON plugin_data.ai_usage_log(gateway_scope);
CREATE INDEX idx_ai_usage_created ON plugin_data.ai_usage_log(created_at);
CREATE INDEX idx_ai_usage_org_month ON plugin_data.ai_usage_log(organization_id, created_at);

COMMENT ON TABLE plugin_data.ai_usage_log IS 'Tracks every AI call for billing attribution. PostHog provides dashboards; this table provides billing data.';

-- ============================================================
-- 6. Enable RLS on all tables (even though accessed via service_role)
-- ============================================================

ALTER TABLE plugin_data.org_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.org_member_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.org_form_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.org_form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.ai_usage_log ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so these policies are for defense-in-depth
-- if something accidentally uses the anon key.

CREATE POLICY "org_seasons_staff_read" ON plugin_data.org_seasons
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "org_seasons_admin_write" ON plugin_data.org_seasons
  FOR ALL USING (private.is_org_admin(organization_id));

CREATE POLICY "form_defs_member_read" ON plugin_data.org_form_definitions
  FOR SELECT USING (
    private.is_org_member(organization_id)
    OR status = 'active'  -- Active forms visible to anyone for submission
  );

CREATE POLICY "form_defs_staff_write" ON plugin_data.org_form_definitions
  FOR ALL USING (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "form_subs_own_read" ON plugin_data.org_form_submissions
  FOR SELECT USING (
    user_id = auth.uid()
    OR private.is_org_staff_or_admin(organization_id)
  );

CREATE POLICY "form_subs_insert" ON plugin_data.org_form_submissions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "form_subs_staff_update" ON plugin_data.org_form_submissions
  FOR UPDATE USING (private.is_org_staff_or_admin(organization_id));
