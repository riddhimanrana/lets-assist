-- Fix: no code path ever populated csf_communication_campaigns.body_text_hash,
-- so every real caller of the finalize-content RPC failed the dispatch-identity
-- CHECK the instant it tried to freeze a campaign's content.
--
-- Root cause: neither csf_create_communication_campaign_draft (draft insert)
-- nor csf_finalize_communication_campaign_content (the finalize UPDATE) ever
-- assigned body_text_hash. The derive trigger
-- (csf_derive_campaign_content_hash) computes content_hash the moment
-- content_finalized_at is set, and csf_communication_campaigns_dispatch_identity_check
-- requires body_text_hash IS NOT NULL whenever content_hash IS NOT NULL — so
-- that UPDATE has never been able to succeed through the public RPCs. The
-- pgTAP suite never caught this because its dispatch-identity and terminalization
-- tests insert rows with a hand-supplied body_text_hash (e.g. repeat('a', 64)),
-- bypassing the real draft/finalize RPCs entirely — no test exercised the
-- actual application path of draft-then-finalize with only derived values.
--
-- Fix: extend the same derive-on-finalize trigger to also compute
-- body_text_hash (required) and body_html_hash (no NOT NULL requirement, but
-- left unpopulated it would be an inconsistent half-derived row once every
-- other digest is present). Same gate as content_hash: NULL pre-finalize or
-- with an empty body, since a draft stays editable and unsendable until then.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_derive_campaign_content_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.content_finalized_at IS NULL
    OR nullif(btrim(coalesce(NEW.body_text, '')), '') IS NULL
  THEN
    NEW.content_hash := NULL;
    NEW.body_text_hash := NULL;
    NEW.body_html_hash := NULL;
    RETURN NEW;
  END IF;

  NEW.content_hash := plugin_data.csf_communication_campaign_content_hash(
    NEW.campaign_kind,
    NEW.channel,
    NEW.sender_name,
    NEW.sender_email,
    NEW.reply_to_email,
    NEW.subject,
    NEW.body_text,
    NEW.body_html,
    NEW.body_metadata,
    NEW.broadcast_topic_key
  );

  NEW.body_text_hash := pg_catalog.encode(
    extensions.digest(NEW.body_text, 'sha256'),
    'hex'
  );

  NEW.body_html_hash := CASE
    WHEN nullif(btrim(coalesce(NEW.body_html, '')), '') IS NULL THEN NULL
    ELSE pg_catalog.encode(extensions.digest(NEW.body_html, 'sha256'), 'hex')
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_derive_campaign_content_hash()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plugin_data.csf_derive_campaign_content_hash() IS
  'Overwrites any caller-supplied campaign content_hash, body_text_hash, and body_html_hash with server-derived digests -- but only once content_finalized_at is set. A draft with a full body is still editable and unsendable, so a caller-declared hash is never accepted as proof of content OR of readiness. body_text_hash is required by csf_communication_campaigns_dispatch_identity_check for every dispatch-ready row; body_html_hash mirrors it for consistency and has no NOT NULL requirement of its own.';

COMMIT;
