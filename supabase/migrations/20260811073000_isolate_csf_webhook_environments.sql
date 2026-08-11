-- Resend webhook subscriptions are account-wide. Production and Development
-- therefore receive the same signed events, even though their CSF ledgers live
-- in different Supabase projects. Bind every new provider request to its owning
-- backend so a foreign endpoint can acknowledge the event without attempting a
-- cross-environment tenant lookup or creating false quarantine evidence.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_communication_campaigns AS campaign
    LEFT JOIN plugin_data.csf_communication_dispatch_attempts AS attempt
      ON attempt.campaign_id = campaign.id
      AND attempt.organization_id = campaign.organization_id
    WHERE (attempt.state IN ('queued', 'processing') OR campaign.status = 'draft')
      AND (
        nullif(btrim(coalesce(campaign.metadata->>'csf_environment', '')), '') IS NULL
        OR campaign.metadata->>'csf_environment' !~ '^[a-z0-9_]{1,64}$'
      )
  ) THEN
    RAISE EXCEPTION
      'CSF webhook environment isolation requires every draft campaign and open dispatch attempt to carry campaign.metadata.csf_environment before this migration is applied.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_communication_provider_request(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_recipient_snapshot_id uuid,
  p_attempt_id uuid,
  p_attempt_number integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_campaign plugin_data.csf_communication_campaigns%ROWTYPE;
  v_snapshot plugin_data.csf_communication_recipient_snapshots%ROWTYPE;
  v_environment text;
  v_headers jsonb;
  v_tags jsonb;
BEGIN
  SELECT campaign.*
  INTO v_campaign
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  SELECT snapshot.*
  INTO v_snapshot
  FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.id = p_recipient_snapshot_id
    AND snapshot.organization_id = p_organization_id
    AND snapshot.campaign_id = p_campaign_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF audience snapshot for this provider request does not exist in this campaign.'
      USING ERRCODE = '23503';
  END IF;

  v_headers := coalesce(v_campaign.body_metadata->'headers', '{}'::jsonb);
  IF pg_catalog.jsonb_typeof(v_headers) <> 'object' THEN
    RAISE EXCEPTION
      'CSF campaign body metadata headers must be a JSON object of provider headers.'
      USING ERRCODE = '22023';
  END IF;

  v_environment := nullif(
    pg_catalog.btrim(coalesce(v_campaign.metadata->>'csf_environment', '')),
    ''
  );

  IF v_environment IS NULL OR v_environment !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION
      'A CSF provider request requires a bounded backend environment coordinate.'
      USING ERRCODE = '23514';
  END IF;

  IF v_campaign.content_hash IS NOT NULL
    AND v_campaign.campaign_kind = 'broadcast'
    AND nullif(btrim(coalesce(v_campaign.resend_topic_id, '')), '') IS NULL
  THEN
    RAISE EXCEPTION
      'A dispatch-ready CSF broadcast must carry a provider topic so the recipient gets a working one-click unsubscribe.'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('name', tag.name, 'value', tag.value)
      ORDER BY tag.name
    ),
    '[]'::jsonb
  )
  INTO v_tags
  FROM (
    VALUES
      ('csf_plugin', 'dvhs_csf'),
      ('csf_environment',
        plugin_data.csf_communication_tag_value(v_environment)),
      ('csf_organization_id',
        plugin_data.csf_communication_tag_value(p_organization_id::text)),
      ('csf_campaign_id',
        plugin_data.csf_communication_tag_value(p_campaign_id::text)),
      ('csf_attempt_id',
        plugin_data.csf_communication_tag_value(p_attempt_id::text)),
      ('csf_topic_key',
        plugin_data.csf_communication_tag_value(v_snapshot.topic_key))
  ) AS tag(name, value)
  WHERE tag.value IS NOT NULL;

  RETURN pg_catalog.jsonb_build_object(
    'v', 3,
    'coordinate', pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'campaignId', p_campaign_id,
      'recipientSnapshotId', p_recipient_snapshot_id,
      'attemptId', p_attempt_id,
      'attemptNumber', p_attempt_number,
      'contentHash', v_campaign.content_hash,
      'recipientSnapshotHash', v_snapshot.recipient_snapshot_hash,
      'deliveryRequirement', v_snapshot.delivery_requirement,
      'topicKey', v_snapshot.topic_key
    ),
    'providerPayload', pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'from', pg_catalog.concat(
          coalesce(v_campaign.sender_name, ''), ' <',
          pg_catalog.lower(pg_catalog.btrim(coalesce(v_campaign.sender_email, ''))), '>'
        ),
        'to', pg_catalog.lower(pg_catalog.btrim(coalesce(v_snapshot.recipient_email, ''))),
        'replyTo', pg_catalog.lower(pg_catalog.btrim(coalesce(v_campaign.reply_to_email, ''))),
        'subject', v_campaign.subject,
        'text', v_campaign.body_text,
        'html', v_campaign.body_html,
        'tags', v_tags,
        'headers', nullif(v_headers, '{}'::jsonb),
        'topicId', CASE
          WHEN v_campaign.campaign_kind = 'broadcast'
            THEN nullif(btrim(coalesce(v_campaign.resend_topic_id, '')), '')
          ELSE NULL
        END,
        'type', 'transactional'
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_provider_request(
  uuid, uuid, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_provider_request(
  uuid, uuid, uuid, uuid, integer
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_communication_provider_request(
  uuid, uuid, uuid, uuid, integer
) IS
  'Builds the canonical hashed provider request and requires the signed csf_environment backend coordinate alongside the plugin, organization, campaign, attempt, and topic tags. The worker forwards this exact payload unchanged.';
