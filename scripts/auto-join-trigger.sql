-- Auto-join trigger for new users based on email domain
-- Applies server-side so OAuth and email/password flows behave consistently.

create or replace function public.handle_auto_join_on_signup()
returns trigger
language plpgsql
security definer
as $$
declare
  user_domain text;
  matching_org record;
begin
  -- Only auto-join users whose email is verified.
  -- Supabase may populate either email_confirmed_at or confirmed_at depending on auth flow.
  if NEW.email_confirmed_at is null and NEW.confirmed_at is null then
    return NEW;
  end if;

  user_domain := lower(split_part(NEW.email, '@', 2));

  if user_domain is null or user_domain = '' then
    return NEW;
  end if;

  select id, name into matching_org
  from public.organizations
  where auto_join_domain = user_domain
  limit 1;

  if matching_org.id is not null then
    insert into public.organization_members (organization_id, user_id, role, joined_at)
    values (matching_org.id, NEW.id, 'member', timezone('utc', now()))
    on conflict (organization_id, user_id) do nothing;

    update auth.users
    set raw_user_meta_data = case
        when raw_user_meta_data is null then jsonb_build_object(
          'auto_joined_org_id', matching_org.id,
          'auto_joined_org_name', matching_org.name
        )
        else raw_user_meta_data || jsonb_build_object(
          'auto_joined_org_id', matching_org.id,
          'auto_joined_org_name', matching_org.name
        )
      end
    where id = NEW.id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists on_auth_user_auto_join on auth.users;
create trigger on_auth_user_auto_join
  after insert on auth.users
  for each row
  execute function public.handle_auto_join_on_signup();
