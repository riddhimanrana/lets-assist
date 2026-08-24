-- DVHS CSF: optional email when an activity is first published.
--
-- Activity publication and email queueing remain separate outcomes. A published
-- activity may request one consent-aware campaign through the existing durable
-- ledger. The campaign freezes the exact term, optional class, provider topic,
-- content, and recipient snapshot. Retried requests converge on the same live
-- campaign and never bypass the manage_opportunities capability.

begin;

alter table plugin_data.csf_communication_campaigns
  add column source_activity_id uuid;

alter table plugin_data.csf_communication_campaigns
  add constraint csf_communication_campaigns_source_activity_organization_fkey
    foreign key (source_activity_id, organization_id)
    references plugin_data.csf_opportunities (id, organization_id)
    on delete restrict,
  add constraint csf_communication_campaigns_one_source_check
    check (pg_catalog.num_nonnulls(source_announcement_id, source_activity_id) <= 1);

create unique index csf_communication_campaigns_live_activity_source_key
  on plugin_data.csf_communication_campaigns (
    organization_id,
    source_activity_id
  )
  where source_activity_id is not null and status <> 'cancelled';

comment on column plugin_data.csf_communication_campaigns.source_activity_id is
  'Optional same-organization published activity that originated this one-time campaign. A partial unique index keeps one live campaign per activity.';

create function plugin_data.csf_guard_activity_email_campaign_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity plugin_data.csf_opportunities%rowtype;
  v_expected_audience_kind text;
begin
  if tg_op = 'UPDATE'
    and new.source_activity_id is distinct from old.source_activity_id
  then
    raise exception 'A CSF campaign source activity is immutable.'
      using errcode = '23514';
  end if;

  if new.source_activity_id is null then
    return new;
  end if;

  select activity.*
  into v_activity
  from plugin_data.csf_opportunities as activity
  where activity.id = new.source_activity_id
    and activity.organization_id = new.organization_id
  for share;

  if not found then
    raise exception
      'That CSF campaign source activity does not belong to this organization.'
      using errcode = '23503';
  end if;

  v_expected_audience_kind := case
    when v_activity.cohort_id is null then 'term_members'
    else 'cohort_members'
  end;

  if new.campaign_kind <> 'broadcast'
    or new.term_id is distinct from v_activity.term_id
    or new.audience_kind is distinct from v_expected_audience_kind
    or new.audience_cohort_id is distinct from v_activity.cohort_id
  then
    raise exception
      'An activity campaign must preserve its source activity term and class audience.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

alter function plugin_data.csf_guard_activity_email_campaign_scope()
  owner to postgres;
revoke all on function plugin_data.csf_guard_activity_email_campaign_scope()
  from public, anon, authenticated, service_role;
grant execute on function plugin_data.csf_guard_activity_email_campaign_scope()
  to postgres;

create trigger csf_communication_campaigns_activity_scope_guard
before insert or update on plugin_data.csf_communication_campaigns
for each row execute function
  plugin_data.csf_guard_activity_email_campaign_scope();

create function plugin_data.csf_create_activity_email_campaign_draft(
  p_organization_id uuid,
  p_source_activity_id uuid,
  p_subject text,
  p_body_text text,
  p_actor_user_id uuid,
  p_term_id uuid,
  p_audience_kind text,
  p_body_html text default null,
  p_broadcast_topic_key text default null,
  p_resend_topic_id text default null,
  p_tags jsonb default '{}'::jsonb,
  p_correlation_id text default null,
  p_audience_cohort_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_capability constant text := 'manage_opportunities';
  c_sender_name constant text := 'DVHS CSF';
  c_sender_email constant text := 'csf@notifications.lets-assist.com';
  c_reply_to constant text := 'dvhighcsf@gmail.com';
  v_subject text := nullif(pg_catalog.btrim(coalesce(p_subject, '')), '');
  v_body_text text := nullif(pg_catalog.btrim(coalesce(p_body_text, '')), '');
  v_body_html text := nullif(pg_catalog.btrim(coalesce(p_body_html, '')), '');
  v_topic text := nullif(
    pg_catalog.btrim(coalesce(p_broadcast_topic_key, '')),
    ''
  );
  v_resend_topic text := nullif(
    pg_catalog.btrim(coalesce(p_resend_topic_id, '')),
    ''
  );
  v_correlation text := nullif(
    pg_catalog.btrim(coalesce(p_correlation_id, '')),
    ''
  );
  v_tags jsonb := coalesce(p_tags, '{}'::jsonb);
  v_actor_identity text;
  v_expected_audience_kind text;
  v_campaign_id uuid;
  v_existing plugin_data.csf_communication_campaigns%rowtype;
  v_activity plugin_data.csf_opportunities%rowtype;
begin
  if p_organization_id is null or p_source_activity_id is null then
    raise exception
      'A CSF activity email draft requires an organization and a source activity.'
      using errcode = '22004';
  end if;

  if p_actor_user_id is null then
    raise exception
      'A CSF activity email draft must record the staff account that requested it.'
      using errcode = '22004';
  end if;

  if not plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    c_capability
  ) then
    raise exception
      'That account cannot email an activity in this organization.'
      using errcode = '42501';
  end if;

  if v_subject is null or pg_catalog.char_length(v_subject) > 200 then
    raise exception 'A CSF activity email subject is 1 to 200 characters.'
      using errcode = '22023';
  end if;

  if v_body_text is null or pg_catalog.char_length(v_body_text) > 20000 then
    raise exception
      'A CSF activity email plain-text body is 1 to 20000 characters.'
      using errcode = '22023';
  end if;

  if v_body_html is not null
    and pg_catalog.char_length(v_body_html) > 60000
  then
    raise exception 'A CSF activity email HTML body is at most 60000 characters.'
      using errcode = '22023';
  end if;

  if p_term_id is null then
    raise exception 'A CSF activity email requires its semester.'
      using errcode = '22004';
  end if;

  if p_audience_kind not in ('term_members', 'cohort_members') then
    raise exception
      'A CSF activity email targets current term members or one class.'
      using errcode = '22023';
  end if;

  if v_topic is null or v_resend_topic is null then
    raise exception
      'A CSF activity email requires both consent and provider topics.'
      using errcode = '22004';
  end if;

  if v_correlation is not null
    and (
      v_correlation ~ '\s'
      or pg_catalog.char_length(v_correlation) > 128
    )
  then
    raise exception
      'A CSF correlation identifier is whitespace-free and at most 128 characters.'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(v_tags) <> 'object'
    or (select count(*) from pg_catalog.jsonb_object_keys(v_tags)) > 10
    or plugin_data.csf_jsonb_carries_raw_content(v_tags)
  then
    raise exception
      'CSF activity email tags are at most 10 routing fields and may not carry message content.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-activity-email:' || p_organization_id::text || ':'
        || p_source_activity_id::text,
      0
    )
  );

  select activity.*
  into v_activity
  from plugin_data.csf_opportunities as activity
  where activity.id = p_source_activity_id
    and activity.organization_id = p_organization_id
  for share;

  if not found then
    raise exception 'That CSF activity does not belong to this organization.'
      using errcode = '23503';
  end if;

  if v_activity.status <> 'published'
    or v_activity.published_at is null
  then
    raise exception 'Only a published CSF activity can be emailed.'
      using errcode = '23514';
  end if;

  v_expected_audience_kind := case
    when v_activity.cohort_id is null then 'term_members'
    else 'cohort_members'
  end;

  if p_term_id is distinct from v_activity.term_id
    or p_audience_kind is distinct from v_expected_audience_kind
    or p_audience_cohort_id is distinct from v_activity.cohort_id
  then
    raise exception
      'The activity email must match its published semester and class audience.'
      using errcode = '23514';
  end if;

  perform plugin_data.csf_assert_post_email_topic_configuration(
    p_organization_id,
    p_audience_kind,
    v_topic,
    v_resend_topic
  );

  select campaign.*
  into v_existing
  from plugin_data.csf_communication_campaigns as campaign
  where campaign.organization_id = p_organization_id
    and campaign.source_activity_id = p_source_activity_id
    and campaign.status <> 'cancelled'
  for update;

  if found then
    if v_existing.term_id is distinct from p_term_id
      or v_existing.audience_kind is distinct from p_audience_kind
      or v_existing.broadcast_topic_key is distinct from v_topic
      or v_existing.resend_topic_id is distinct from v_resend_topic
      or v_existing.audience_cohort_id is distinct from p_audience_cohort_id
    then
      raise exception
        'The existing activity email campaign no longer matches its frozen audience.'
        using errcode = '23514';
    end if;

    if v_existing.status = 'failed'
      or v_existing.review_blocked_at is not null
    then
      raise exception
        'The existing activity email campaign requires Communications review.'
        using errcode = '23514';
    end if;

    return pg_catalog.jsonb_build_object(
      'campaignId', v_existing.id,
      'status', v_existing.status,
      'campaignKind', v_existing.campaign_kind,
      'correlationId', v_correlation,
      'idempotentReplay', true
    );
  end if;

  select pg_catalog.lower(pg_catalog.btrim(coalesce(account.email, '')))
  into v_actor_identity
  from auth.users as account
  where account.id = p_actor_user_id;

  v_actor_identity := coalesce(
    nullif(v_actor_identity, ''),
    'user:' || p_actor_user_id::text
  );
  v_campaign_id := pg_catalog.gen_random_uuid();

  begin
    insert into plugin_data.csf_communication_campaigns (
      id,
      organization_id,
      campaign_kind,
      status,
      channel,
      sender_name,
      sender_email,
      reply_to_email,
      subject,
      body_text,
      body_html,
      term_id,
      audience_kind,
      broadcast_topic_key,
      resend_topic_id,
      source_activity_id,
      audience_cohort_id,
      created_by,
      created_by_identity,
      metadata,
      audience_snapshot_version,
      provider_idempotency_key
    ) values (
      v_campaign_id,
      p_organization_id,
      'broadcast',
      'draft',
      'email',
      c_sender_name,
      c_sender_email,
      c_reply_to,
      v_subject,
      v_body_text,
      v_body_html,
      p_term_id,
      p_audience_kind,
      v_topic,
      v_resend_topic,
      p_source_activity_id,
      p_audience_cohort_id,
      p_actor_user_id,
      v_actor_identity,
      v_tags,
      1,
      'csf-campaign-' || v_campaign_id::text
    );
  exception when unique_violation then
    select campaign.*
    into v_existing
    from plugin_data.csf_communication_campaigns as campaign
    where campaign.organization_id = p_organization_id
      and campaign.source_activity_id = p_source_activity_id
      and campaign.status <> 'cancelled'
    for update;

    if not found then
      raise;
    end if;

    return pg_catalog.jsonb_build_object(
      'campaignId', v_existing.id,
      'status', v_existing.status,
      'campaignKind', v_existing.campaign_kind,
      'correlationId', v_correlation,
      'idempotentReplay', true
    );
  end;

  return pg_catalog.jsonb_build_object(
    'campaignId', v_campaign_id,
    'status', 'draft',
    'campaignKind', 'broadcast',
    'correlationId', v_correlation,
    'idempotentReplay', false
  );
end;
$$;

alter function plugin_data.csf_create_activity_email_campaign_draft(
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  uuid
) owner to postgres;
revoke all on function plugin_data.csf_create_activity_email_campaign_draft(
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function plugin_data.csf_create_activity_email_campaign_draft(
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  uuid
) to postgres, service_role;

comment on function plugin_data.csf_create_activity_email_campaign_draft(
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  uuid
) is
  'Creates or returns one live broadcast campaign for a same-organization published CSF activity. Requires manage_opportunities and freezes the exact term, optional class, and consent topic.';

create function plugin_data.csf_finalize_activity_email_campaign_content(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_actor_user_id uuid,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_capability constant text := 'manage_opportunities';
  v_correlation text := nullif(
    pg_catalog.btrim(coalesce(p_correlation_id, '')),
    ''
  );
  v_actor_identity text;
  v_expected_audience_kind text;
  v_now timestamptz := pg_catalog.now();
  v_campaign plugin_data.csf_communication_campaigns%rowtype;
  v_activity plugin_data.csf_opportunities%rowtype;
  v_content_hash text;
begin
  if p_organization_id is null or p_campaign_id is null then
    raise exception
      'A CSF activity email finalization requires an organization and campaign.'
      using errcode = '22004';
  end if;

  if p_actor_user_id is null then
    raise exception
      'A CSF activity email finalization must record its approving staff account.'
      using errcode = '22004';
  end if;

  if not plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    c_capability
  ) then
    raise exception
      'That account cannot finalize an activity email in this organization.'
      using errcode = '42501';
  end if;

  if v_correlation is not null
    and (
      v_correlation ~ '\s'
      or pg_catalog.char_length(v_correlation) > 128
    )
  then
    raise exception
      'A CSF correlation identifier is whitespace-free and at most 128 characters.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-campaign:' || p_organization_id::text || ':'
        || p_campaign_id::text,
      0
    )
  );

  select campaign.*
  into v_campaign
  from plugin_data.csf_communication_campaigns as campaign
  where campaign.id = p_campaign_id
    and campaign.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'That CSF campaign does not exist in this organization.'
      using errcode = '23503';
  end if;

  if v_campaign.source_activity_id is null
    or v_campaign.source_announcement_id is not null
    or v_campaign.campaign_kind <> 'broadcast'
  then
    raise exception
      'Only a campaign attached to a published activity can use activity finalization.'
      using errcode = '42501';
  end if;

  select activity.*
  into v_activity
  from plugin_data.csf_opportunities as activity
  where activity.id = v_campaign.source_activity_id
    and activity.organization_id = p_organization_id
  for share;

  if not found
    or v_activity.status <> 'published'
    or v_activity.published_at is null
  then
    raise exception
      'The source activity must still be published in this organization.'
      using errcode = '23514';
  end if;

  v_expected_audience_kind := case
    when v_activity.cohort_id is null then 'term_members'
    else 'cohort_members'
  end;

  if v_campaign.term_id is distinct from v_activity.term_id
    or v_campaign.audience_kind is distinct from v_expected_audience_kind
    or v_campaign.audience_cohort_id is distinct from v_activity.cohort_id
  then
    raise exception
      'The activity campaign no longer matches its published term or class.'
      using errcode = '23514';
  end if;

  if v_campaign.content_finalized_at is not null then
    return pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'campaignId', p_campaign_id,
      'contentFinalizedAt', v_campaign.content_finalized_at,
      'contentHash', v_campaign.content_hash,
      'idempotentReplay', true
    );
  end if;

  perform plugin_data.csf_assert_post_email_topic_configuration(
    p_organization_id,
    v_campaign.audience_kind,
    v_campaign.broadcast_topic_key,
    v_campaign.resend_topic_id
  );

  if v_campaign.status <> 'draft' then
    raise exception
      'CSF activity email content must be finalized while its campaign is a draft.'
      using errcode = '23514';
  end if;

  if nullif(pg_catalog.btrim(coalesce(v_campaign.body_text, '')), '') is null then
    raise exception
      'A CSF activity email needs a plain-text body before finalization.'
      using errcode = '23514';
  end if;

  select pg_catalog.lower(pg_catalog.btrim(coalesce(account.email, '')))
  into v_actor_identity
  from auth.users as account
  where account.id = p_actor_user_id;

  v_actor_identity := coalesce(
    nullif(v_actor_identity, ''),
    'user:' || p_actor_user_id::text
  );

  update plugin_data.csf_communication_campaigns
  set
    content_finalized_at = v_now,
    content_finalized_by = p_actor_user_id,
    content_finalized_by_identity = v_actor_identity,
    correlation_id = coalesce(correlation_id, v_correlation),
    updated_at = v_now
  where id = p_campaign_id
    and organization_id = p_organization_id
  returning content_hash into v_content_hash;

  return pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignId', p_campaign_id,
    'contentFinalizedAt', v_now,
    'contentHash', v_content_hash,
    'actorUserId', p_actor_user_id,
    'actorIdentity', v_actor_identity,
    'correlationId', v_correlation,
    'idempotentReplay', false
  );
end;
$$;

alter function plugin_data.csf_finalize_activity_email_campaign_content(
  uuid,
  uuid,
  uuid,
  text
) owner to postgres;
revoke all on function plugin_data.csf_finalize_activity_email_campaign_content(
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;
grant execute on function plugin_data.csf_finalize_activity_email_campaign_content(
  uuid,
  uuid,
  uuid,
  text
) to postgres, service_role;

comment on function plugin_data.csf_finalize_activity_email_campaign_content(
  uuid,
  uuid,
  uuid,
  text
) is
  'Finalizes only a broadcast campaign still attached to a same-organization published activity. Requires manage_opportunities and revalidates the frozen term, optional class, and consent topic.';

commit;
