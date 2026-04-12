-- Migration: Shared billing/payments infrastructure in plugin_data
-- Designed as a PLATFORM SERVICE that any plugin can use:
--   - DVSD: membership dues, tournament fees
--   - Paid Signups plugin: event registration fees
--   - Fundraiser plugin: donations
--   - etc.

-- ============================================================
-- 1. Organization Billing Accounts
-- Links an org to Stripe for both directions:
--   - org pays Let's Assist (stripe_customer_id)
--   - users pay org (stripe_connect_account_id — Stripe Connect)
-- ============================================================

CREATE TYPE plugin_data.connect_onboarding_status AS ENUM (
  'not_started',
  'pending',
  'in_review',
  'active',
  'restricted',
  'disabled'
);

CREATE TABLE plugin_data.org_billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Org pays Let's Assist (regular Stripe Customer)
  stripe_customer_id text UNIQUE,

  -- Users pay Org (Stripe Connect)
  stripe_connect_account_id text UNIQUE,
  connect_onboarding_status plugin_data.connect_onboarding_status DEFAULT 'not_started',
  connect_charges_enabled boolean DEFAULT false,
  connect_payouts_enabled boolean DEFAULT false,
  connect_country text DEFAULT 'US',
  connect_default_currency text DEFAULT 'usd',

  -- Platform fee settings
  platform_fee_percent numeric(5, 2) DEFAULT 0,  -- Let's Assist take rate (0 = no fee)

  -- Metadata
  billing_email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_billing_accounts_org ON plugin_data.org_billing_accounts(organization_id);
CREATE INDEX idx_billing_accounts_connect ON plugin_data.org_billing_accounts(stripe_connect_account_id);

COMMENT ON TABLE plugin_data.org_billing_accounts IS 'Stripe configuration for orgs. Supports both platform billing (org→LA) and connected payments (user→org via Stripe Connect).';

-- ============================================================
-- 2. Payment Requests — generic, plugin-composable
-- Any plugin creates a payment_request; the platform handles Stripe.
-- ============================================================

CREATE TYPE plugin_data.payment_request_status AS ENUM (
  'pending',        -- Created, waiting for payment
  'processing',     -- Payment in progress
  'succeeded',      -- Payment completed
  'failed',         -- Payment failed
  'cancelled',      -- Cancelled before payment
  'refunded',       -- Fully refunded
  'partially_refunded'  -- Partially refunded
);

CREATE TABLE plugin_data.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plugin_key text NOT NULL,               -- Which plugin created this charge

  -- Who's paying
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payer_email text,                       -- Fallback for non-authenticated users
  payer_name text,

  -- Payment details
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd',
  description text NOT NULL,

  -- Context linking — what is this payment for?
  context_type text NOT NULL,             -- 'membership', 'signup', 'tournament', 'form_submission', 'custom'
  context_id uuid,                        -- FK to the relevant record (membership, signup, submission, etc.)

  -- Stripe state
  stripe_payment_intent_id text UNIQUE,
  stripe_checkout_session_id text UNIQUE,
  stripe_charge_id text,
  stripe_refund_id text,

  -- Status
  status plugin_data.payment_request_status DEFAULT 'pending',
  paid_at timestamptz,
  refunded_at timestamptz,
  refund_amount_cents integer,

  -- Platform fee
  platform_fee_cents integer DEFAULT 0,

  -- Plugin-specific metadata
  metadata jsonb DEFAULT '{}',

  -- Lifecycle
  expires_at timestamptz,                 -- Auto-cancel if not paid by this time
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_payment_requests_org ON plugin_data.payment_requests(organization_id);
CREATE INDEX idx_payment_requests_user ON plugin_data.payment_requests(user_id);
CREATE INDEX idx_payment_requests_plugin ON plugin_data.payment_requests(plugin_key);
CREATE INDEX idx_payment_requests_status ON plugin_data.payment_requests(organization_id, status);
CREATE INDEX idx_payment_requests_context ON plugin_data.payment_requests(context_type, context_id);
CREATE INDEX idx_payment_requests_stripe_pi ON plugin_data.payment_requests(stripe_payment_intent_id);
CREATE INDEX idx_payment_requests_stripe_cs ON plugin_data.payment_requests(stripe_checkout_session_id);

COMMENT ON TABLE plugin_data.payment_requests IS 'Generic payment tracking. Any plugin can create charges; the platform handles Stripe. Supports Stripe Connect for org payouts.';

-- ============================================================
-- 3. Billing Events — audit log for all payment lifecycle events
-- ============================================================

CREATE TABLE plugin_data.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid REFERENCES plugin_data.payment_requests(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  event_type text NOT NULL,               -- 'created', 'processing', 'succeeded', 'failed', 'refunded', 'webhook_received'
  stripe_event_id text,                   -- Stripe webhook event ID for idempotency
  amount_cents integer,
  details jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_billing_events_payment ON plugin_data.billing_events(payment_request_id);
CREATE INDEX idx_billing_events_org ON plugin_data.billing_events(organization_id);
CREATE INDEX idx_billing_events_stripe ON plugin_data.billing_events(stripe_event_id);

COMMENT ON TABLE plugin_data.billing_events IS 'Immutable audit log of all payment events for debugging and reconciliation.';

-- ============================================================
-- 4. RLS
-- ============================================================

ALTER TABLE plugin_data.org_billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.billing_events ENABLE ROW LEVEL SECURITY;

-- Billing accounts: admins only
CREATE POLICY "billing_accounts_admin" ON plugin_data.org_billing_accounts
  FOR ALL USING (private.is_org_admin(organization_id));

-- Payment requests: own payments or staff
CREATE POLICY "payment_requests_read" ON plugin_data.payment_requests
  FOR SELECT USING (
    user_id = auth.uid()
    OR private.is_org_staff_or_admin(organization_id)
  );

CREATE POLICY "payment_requests_insert" ON plugin_data.payment_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Billing events: staff only (contains sensitive payment data)
CREATE POLICY "billing_events_staff" ON plugin_data.billing_events
  FOR SELECT USING (private.is_org_staff_or_admin(organization_id));
