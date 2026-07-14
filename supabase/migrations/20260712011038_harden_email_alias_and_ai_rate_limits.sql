-- Harden email-alias verification and add a service-only atomic API quota.

alter table public.user_emails
  add column if not exists verification_token_hash text,
  add column if not exists verification_expires_at timestamptz,
  add column if not exists verification_attempts integer not null default 0,
  add column if not exists verification_locked_until timestamptz,
  add column if not exists verification_last_sent_at timestamptz;

alter table public.user_emails
  drop constraint if exists user_emails_verification_attempts_nonnegative;

alter table public.user_emails
  add constraint user_emails_verification_attempts_nonnegative
  check (verification_attempts >= 0);

comment on column public.user_emails.verification_token is
  'Deprecated plaintext verification token. New verification flows store only verification_token_hash.';
comment on column public.user_emails.verification_token_hash is
  'SHA-256 hash of the current email-alias verification code.';

-- RLS alone cannot prevent an owner from supplying verified_at or a token when
-- inserting/updating their own row. Keep reads/deletes owner-scoped, but route
-- all alias creation and verification writes through authenticated server code.
revoke insert, update on table public.user_emails from anon, authenticated;

create or replace function public.verify_user_email_alias(
  p_user_id uuid,
  p_email text,
  p_token_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email_id uuid;
  v_stored_hash text;
  v_expires_at timestamptz;
  v_attempts integer;
  v_locked_until timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  select
    id,
    verification_token_hash,
    verification_expires_at,
    verification_attempts,
    verification_locked_until
  into
    v_email_id,
    v_stored_hash,
    v_expires_at,
    v_attempts,
    v_locked_until
  from public.user_emails
  where user_id = p_user_id
    and email = lower(trim(p_email))
  for update;

  if not found then
    return 'invalid';
  end if;

  if v_locked_until is not null and v_locked_until > v_now then
    return 'locked';
  end if;

  if v_stored_hash is null or v_expires_at is null or v_expires_at <= v_now then
    update public.user_emails
    set
      verification_token_hash = null,
      verification_expires_at = null,
      verification_attempts = 0,
      verification_locked_until = null,
      updated_at = v_now
    where id = v_email_id;
    return 'invalid';
  end if;

  if v_stored_hash = p_token_hash then
    update public.user_emails
    set
      verified_at = v_now,
      verification_token = null,
      verification_token_hash = null,
      verification_expires_at = null,
      verification_attempts = 0,
      verification_locked_until = null,
      updated_at = v_now
    where id = v_email_id;
    return 'verified';
  end if;

  v_attempts := coalesce(v_attempts, 0) + 1;
  update public.user_emails
  set
    verification_attempts = v_attempts,
    verification_locked_until = case
      when v_attempts >= 5 then v_now + interval '15 minutes'
      else null
    end,
    updated_at = v_now
  where id = v_email_id;

  if v_attempts >= 5 then
    return 'locked';
  end if;
  return 'invalid';
end;
$$;

revoke all on function public.verify_user_email_alias(uuid, text, text) from public, anon, authenticated;
grant execute on function public.verify_user_email_alias(uuid, text, text) to service_role;

create table if not exists public.api_rate_limits (
  rate_limit_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint api_rate_limits_request_count_nonnegative check (request_count >= 0),
  constraint api_rate_limits_key_length check (length(rate_limit_key) between 1 and 200)
);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.api_rate_limits to service_role;

create or replace function public.consume_api_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 200 then
    raise exception 'invalid rate-limit key';
  end if;
  if p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid rate limit';
  end if;
  if p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate-limit window';
  end if;

  insert into public.api_rate_limits as limits (
    rate_limit_key,
    window_started_at,
    request_count,
    updated_at
  )
  values (p_key, v_now, 1, v_now)
  on conflict (rate_limit_key) do update
  set
    window_started_at = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
        then v_now
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
        then 1
      else limits.request_count + 1
    end,
    updated_at = v_now
  where
    limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
    or limits.request_count < p_limit
  returning limits.window_started_at, limits.request_count
  into v_window_started_at, v_request_count;

  if not found then
    select limits.window_started_at, limits.request_count
      into v_window_started_at, v_request_count
    from public.api_rate_limits as limits
    where limits.rate_limit_key = p_key;

    return query select
      false,
      0,
      v_window_started_at + make_interval(secs => p_window_seconds);
    return;
  end if;

  return query select
    true,
    greatest(p_limit - v_request_count, 0),
    v_window_started_at + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;
