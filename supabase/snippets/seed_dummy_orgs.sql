do $$
declare
  account_ids uuid[];
  owner_a uuid;
  owner_b uuid;
  member_a uuid;
  member_b uuid;
  member_c uuid;
begin
  select array_agg(u.id order by coalesce(p.created_at, now()) desc)
    into account_ids
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.username is not null;

  if coalesce(array_length(account_ids, 1), 0) < 5 then
    raise notice 'Skipping dummy org seed: need at least 5 auth-backed profiles, found %', coalesce(array_length(account_ids, 1), 0);
    return;
  end if;

  owner_a := account_ids[1];
  owner_b := account_ids[2];
  member_a := account_ids[3];
  member_b := account_ids[4];
  member_c := account_ids[5];

  insert into public.organizations (
    id,
    name,
    username,
    description,
    website,
    type,
    join_code,
    verified,
    created_by,
    allowed_email_domains
  )
  values
    (
      '11111111-1111-4111-8111-111111111111',
      'Acorn Helpers Collective',
      'acorn_helpers_demo',
      'Demo nonprofit org for local testing of memberships, permissions, and onboarding.',
      'https://example.org/acorn-helpers',
      'nonprofit',
      'ACORN1',
      true,
      owner_a,
      'example.org'
    ),
    (
      '22222222-2222-4222-8222-222222222222',
      'Bright Future Academy',
      'bright_future_demo',
      'Demo school org to test volunteer flows and organization dashboards.',
      'https://example.org/bright-future',
      'school',
      'BRGHT2',
      true,
      owner_b,
      'school.org'
    )
  on conflict (id) do update set
    name = excluded.name,
    username = excluded.username,
    description = excluded.description,
    website = excluded.website,
    type = excluded.type,
    join_code = excluded.join_code,
    verified = excluded.verified,
    created_by = excluded.created_by,
    allowed_email_domains = excluded.allowed_email_domains;

  insert into public.organization_members (
    id,
    organization_id,
    user_id,
    role,
    status,
    can_verify_hours,
    is_visible,
    joined_at,
    last_activity_at
  )
  values
    (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', owner_a, 'admin', 'active', true, true, now(), now()),
    (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', member_a, 'staff', 'active', true, true, now(), now()),
    (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', member_b, 'member', 'active', false, true, now(), now()),
    (gen_random_uuid(), '22222222-2222-4222-8222-222222222222', owner_b, 'admin', 'active', true, true, now(), now()),
    (gen_random_uuid(), '22222222-2222-4222-8222-222222222222', member_c, 'staff', 'active', true, true, now(), now()),
    (gen_random_uuid(), '22222222-2222-4222-8222-222222222222', member_a, 'member', 'active', false, true, now(), now())
  on conflict (organization_id, user_id) do update set
    role = excluded.role,
    status = excluded.status,
    can_verify_hours = excluded.can_verify_hours,
    is_visible = excluded.is_visible,
    last_activity_at = excluded.last_activity_at;

  raise notice 'Dummy organizations and members seeded successfully.';
end
$$;
