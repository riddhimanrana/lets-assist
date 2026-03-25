


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."before_insert_org_member"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  PERFORM public.ensure_profile_exists(NEW.user_id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."before_insert_org_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_insert_project"("p_user" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  return public.can_insert_project(p_user, 'public', null);
end;
$$;


ALTER FUNCTION "public"."can_insert_project"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_insert_project"("p_user" "uuid", "p_visibility" "text", "p_organization_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  recent_count int;
begin
  if p_user is null then
    return false;
  end if;

  -- Keep rate limit aligned with application server actions.
  select count(*)
    into recent_count
  from public.projects
  where creator_id = p_user
    and created_at > (now() - interval '24 hours');

  if recent_count >= 50 then
    return false;
  end if;

  -- Public-feed projects require trusted status.
  if coalesce(p_visibility, 'public') = 'public'
     and not public.is_trusted_member(p_user) then
    return false;
  end if;

  -- Organization-affiliated projects require org admin/staff role.
  if p_organization_id is not null
     and not exists (
       select 1
       from public.organization_members om
       where om.organization_id = p_organization_id
         and om.user_id = p_user
         and om.role in ('admin', 'staff')
     ) then
    return false;
  end if;

  return true;
end;
$$;


ALTER FUNCTION "public"."can_insert_project"("p_user" "uuid", "p_visibility" "text", "p_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_keep_or_set_public_visibility"("p_project_id" "uuid", "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    public.is_trusted_member(p_user)
    or exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and p.creator_id = p_user
        and p.visibility = 'public'
    );
$$;


ALTER FUNCTION "public"."can_keep_or_set_public_visibility"("p_project_id" "uuid", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_email_exists"("email_to_check" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM auth.users 
    WHERE LOWER(email) = LOWER(email_to_check)
  );
END;
$$;


ALTER FUNCTION "public"."check_email_exists"("email_to_check" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_username_unique"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (
    select 1 from auth.users
    where raw_user_meta_data->>'username' = new.raw_user_meta_data->>'username'
    and id != new.id
  ) then
    raise exception 'Username already taken';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."check_username_unique"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_username_unique"("username" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
    -- Set a fixed search path
    SET search_path TO public;

    -- Function logic to check if the username is unique
    RETURN NOT EXISTS (SELECT 1 FROM users WHERE username = username);
END;
$$;


ALTER FUNCTION "public"."check_username_unique"("username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."checkin_signups"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
DECLARE
    signup RECORD;
    -- Stores the calculated start time, converted to UTC timestamp with time zone
    calculated_start_time_timestamptz TIMESTAMP WITH TIME ZONE;
    event_date_str TEXT;
    target_date_str TEXT;
    slot_index INT;
    day_element JSONB;
    slot_element JSONB;
    role_element JSONB;
    time_str TEXT; -- Holds the start time part, e.g., "09:00"
    project_tz TEXT;
    current_time_utc TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Get the current time once at the beginning for consistency within the run
    current_time_utc := NOW();
    RAISE NOTICE 'Starting auto_check_in_signups function execution at %', current_time_utc;

    FOR signup IN
        SELECT
            ps.id,
            ps.schedule_id,
            p.schedule,
            p.event_type,
            p.project_timezone
        FROM public.project_signups ps
        JOIN public.projects p ON ps.project_id = p.id
        WHERE p.verification_method = 'auto'
          AND ps.check_in_time IS NULL
          AND ps.status = 'approved'
    LOOP
        -- Reset variables for each iteration
        calculated_start_time_timestamptz := NULL;
        event_date_str := NULL;
        time_str := NULL;
        project_tz := COALESCE(signup.project_timezone, 'America/Los_Angeles');

        BEGIN
            -- Determine the start time based on the event_type and schedule_id
            IF signup.event_type = 'oneTime' THEN
                IF signup.schedule ? 'oneTime' AND signup.schedule_id = 'oneTime' THEN
                    event_date_str := signup.schedule->'oneTime'->>'date';
                    time_str := signup.schedule->'oneTime'->>'startTime';
                    IF event_date_str IS NOT NULL AND time_str IS NOT NULL THEN
                        calculated_start_time_timestamptz := (event_date_str || ' ' || time_str)::timestamp without time zone
                                                             AT TIME ZONE project_tz
                                                             AT TIME ZONE 'UTC';
                    END IF;
                END IF;

            ELSIF signup.event_type = 'multiDay' THEN
                IF signup.schedule ? 'multiDay' AND signup.schedule_id ~ '^\\d{4}-\\d{2}-\\d{2}-\\d+$' THEN
                    target_date_str := substring(signup.schedule_id from '^\\d{4}-\\d{2}-\\d{2}');
                    slot_index := substring(signup.schedule_id from '-(\\d+)$')::INT;

                    SELECT elem INTO day_element
                    FROM jsonb_array_elements(signup.schedule->'multiDay') elem
                    WHERE elem->>'date' = target_date_str;

                    IF day_element IS NOT NULL AND day_element ? 'slots' AND jsonb_typeof(day_element->'slots') = 'array' AND slot_index < jsonb_array_length(day_element->'slots') THEN
                        slot_element := day_element->'slots'->slot_index;
                        time_str := slot_element->>'startTime';
                        IF slot_element IS NOT NULL AND time_str IS NOT NULL THEN
                             calculated_start_time_timestamptz := (target_date_str || ' ' || time_str)::timestamp without time zone
                                                                  AT TIME ZONE project_tz
                                                                  AT TIME ZONE 'UTC';
                        END IF;
                    END IF;
                END IF;

            ELSIF signup.event_type = 'sameDayMultiArea' THEN
                 IF signup.schedule ? 'sameDayMultiArea' THEN
                    event_date_str := signup.schedule->'sameDayMultiArea'->>'date';
                    IF event_date_str IS NOT NULL AND signup.schedule->'sameDayMultiArea' ? 'roles' AND jsonb_typeof(signup.schedule->'sameDayMultiArea'->'roles') = 'array' THEN
                        SELECT elem INTO role_element
                        FROM jsonb_array_elements(signup.schedule->'sameDayMultiArea'->'roles') elem
                        WHERE elem->>'name' = signup.schedule_id;

                        time_str := role_element->>'startTime';
                        IF role_element IS NOT NULL AND time_str IS NOT NULL THEN
                            calculated_start_time_timestamptz := (event_date_str || ' ' || time_str)::timestamp without time zone
                                                                 AT TIME ZONE project_tz
                                                                 AT TIME ZONE 'UTC';
                        END IF;
                    END IF;
                END IF;
            END IF;

            -- Check if we successfully calculated a start time
            IF calculated_start_time_timestamptz IS NOT NULL THEN
                -- Compare current UTC time with the calculated UTC start time
                IF current_time_utc >= calculated_start_time_timestamptz THEN
                    RAISE NOTICE 'Auto-checking in signup ID % for schedule ID %. Scheduled start (UTC): %. Current time (UTC): %.', signup.id, signup.schedule_id, calculated_start_time_timestamptz, current_time_utc;

                    UPDATE public.project_signups
                    SET
                        check_in_time = calculated_start_time_timestamptz,
                        status = 'attended'
                    WHERE id = signup.id
                      AND status = 'approved';

                END IF;
            END IF;

        EXCEPTION WHEN others THEN
            RAISE WARNING 'Error processing signup ID % (Schedule ID: %): %', signup.id, signup.schedule_id, SQLERRM;
            CONTINUE;
        END;

    END LOOP;

    RAISE NOTICE 'Finished auto_check_in_signups function execution at %', NOW();
END;$_$;


ALTER FUNCTION "public"."checkin_signups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."checkout_signups"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
DECLARE
    signup RECORD;
    end_time TIMESTAMP WITH TIME ZONE;
    event_date_str TEXT;
    target_date_str TEXT;
    slot_index INT;
    day_element JSONB;
    slot_element JSONB;
    role_element JSONB;
    time_str TEXT;
    project_tz TEXT;
BEGIN
    FOR signup IN
        SELECT
            ps.id,
            ps.schedule_id,
            ps.check_in_time,
            p.schedule,
            p.event_type,
            p.project_timezone
        FROM public.project_signups ps
        JOIN public.projects p ON ps.project_id = p.id
        WHERE ps.check_out_time IS NULL
          AND ps.status = 'attended'
          AND p.verification_method IN ('qr-code', 'manual', 'auto')
    LOOP
        end_time := NULL;
        time_str := NULL;
        project_tz := COALESCE(signup.project_timezone, 'America/Los_Angeles');

        -- Determine the end time based on the event_type
        IF signup.event_type = 'oneTime' THEN
            IF signup.schedule ? 'oneTime' AND signup.schedule_id = 'oneTime' THEN
                event_date_str := signup.schedule->'oneTime'->>'date';
                time_str := signup.schedule->'oneTime'->>'endTime';
                IF event_date_str IS NOT NULL AND time_str IS NOT NULL THEN
                    end_time := (event_date_str || ' ' || time_str)::timestamp without time zone
                                 AT TIME ZONE project_tz
                                 AT TIME ZONE 'UTC';
                END IF;
            END IF;

        ELSIF signup.event_type = 'multiDay' THEN
            IF signup.schedule ? 'multiDay' AND signup.schedule_id ~ '^\\d{4}-\\d{2}-\\d{2}-\\d+$' THEN
                BEGIN
                    target_date_str := substring(signup.schedule_id from '^\\d{4}-\\d{2}-\\d{2}');
                    slot_index := substring(signup.schedule_id from '-(\\d+)$')::INT;

                    SELECT elem INTO day_element
                    FROM jsonb_array_elements(signup.schedule->'multiDay') elem
                    WHERE elem->>'date' = target_date_str;

                    IF day_element IS NOT NULL AND day_element ? 'slots' AND jsonb_typeof(day_element->'slots') = 'array' AND slot_index < jsonb_array_length(day_element->'slots') THEN
                        slot_element := day_element->'slots'->slot_index;
                        time_str := slot_element->>'endTime';
                        IF slot_element IS NOT NULL AND time_str IS NOT NULL THEN
                             end_time := (target_date_str || ' ' || time_str)::timestamp without time zone
                                          AT TIME ZONE project_tz
                                          AT TIME ZONE 'UTC';
                        END IF;
                    END IF;
                EXCEPTION WHEN others THEN
                    RAISE NOTICE 'Error processing multiDay schedule_id % for signup %: %', signup.schedule_id, signup.id, SQLERRM;
                END;
            END IF;

        ELSIF signup.event_type = 'sameDayMultiArea' THEN
             IF signup.schedule ? 'sameDayMultiArea' THEN
                event_date_str := signup.schedule->'sameDayMultiArea'->>'date';
                IF event_date_str IS NOT NULL AND signup.schedule->'sameDayMultiArea' ? 'roles' AND jsonb_typeof(signup.schedule->'sameDayMultiArea'->'roles') = 'array' THEN
                    SELECT elem INTO role_element
                    FROM jsonb_array_elements(signup.schedule->'sameDayMultiArea'->'roles') elem
                    WHERE elem->>'name' = signup.schedule_id;

                    time_str := role_element->>'endTime';
                    IF role_element IS NOT NULL AND time_str IS NOT NULL THEN
                        end_time := (event_date_str || ' ' || time_str)::timestamp without time zone
                                     AT TIME ZONE project_tz
                                     AT TIME ZONE 'UTC';
                    END IF;
                END IF;
            END IF;
        END IF;

        -- Update the check_out_time if an end_time was found
        IF end_time IS NOT NULL THEN
            UPDATE public.project_signups
            SET check_out_time = end_time
            WHERE id = signup.id
              AND check_out_time IS NULL;
        END IF;
    END LOOP;
END;$_$;


ALTER FUNCTION "public"."checkout_signups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_trusted_member_on_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  UPDATE public.profiles
  SET trusted_member = false
  WHERE id = COALESCE(OLD.user_id, OLD.id);
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."clear_trusted_member_on_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_old_anonymous_signups"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  WITH project_end_dates AS (
    SELECT
      ps.anonymous_id,
      MAX(
        CASE
          WHEN p.event_type = 'oneTime' THEN NULLIF(p.schedule->'oneTime'->>'date', '')::date
          WHEN p.event_type = 'sameDayMultiArea' THEN NULLIF(p.schedule->'sameDayMultiArea'->>'date', '')::date
          WHEN p.event_type = 'multiDay' THEN (
            SELECT MAX(NULLIF(day->>'date', '')::date)
            FROM jsonb_array_elements(COALESCE(p.schedule->'multiDay', '[]'::jsonb)) AS day
          )
          ELSE NULL
        END
      ) AS project_end_date
    FROM public.project_signups ps
    JOIN public.projects p ON p.id = ps.project_id
    WHERE ps.anonymous_id IS NOT NULL
    GROUP BY ps.anonymous_id
  ),
  candidates AS (
    SELECT a.id
    FROM public.anonymous_signups a
    LEFT JOIN project_end_dates ped ON ped.anonymous_id = a.id
    WHERE a.linked_user_id IS NULL
      AND (
        (ped.project_end_date IS NOT NULL AND ped.project_end_date < (CURRENT_DATE - INTERVAL '30 days')::date)
        OR
        (ped.project_end_date IS NULL AND a.created_at < NOW() - INTERVAL '30 days')
      )
  ),
  deleted_signups AS (
    DELETE FROM public.project_signups ps
    USING candidates c
    WHERE ps.anonymous_id = c.id
    RETURNING 1
  ),
  deleted AS (
    DELETE FROM public.anonymous_signups a
    USING candidates c
    WHERE a.id = c.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."delete_old_anonymous_signups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_unconfirmed_users"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
    DELETE FROM auth.users
    WHERE email_confirmed_at IS NULL 
      AND confirmation_sent_at < (now() - interval '15 minutes');
END;
$$;


ALTER FUNCTION "public"."delete_unconfirmed_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user"() RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Delete user from auth.users which will cascade to public.profiles
  DELETE FROM auth.users WHERE id = auth.uid();
  RETURN json_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."delete_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_profile_exists"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, created_at, updated_at)
  VALUES (p_user_id, timezone('utc', now()), timezone('utc', now()))
  ON CONFLICT (id) DO UPDATE
    SET updated_at = EXCLUDED.updated_at;
END;
$$;


ALTER FUNCTION "public"."ensure_profile_exists"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gen_unique_username"("base" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  candidate text := 'user';
  suffix text;
  attempts int := 0;
BEGIN
  -- Always use uuid-derived suffixes; ignore provided base
  LOOP
    IF attempts = 0 THEN
      suffix := left(replace(gen_random_uuid()::text, '-', ''), 8);
    ELSE
      suffix := left(to_hex((floor(random()*4294967295))::bigint), 8);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = candidate || '_' || suffix) THEN
      RETURN candidate || '_' || suffix;
    END IF;

    attempts := attempts + 1;
    IF attempts > 20 THEN
      RETURN candidate || '_' || left(replace(gen_random_uuid()::text, '-', ''), 12);
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."gen_unique_username"("base" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_auth_avatar_url"("auth_user" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth', 'pg_temp'
    AS $$
DECLARE
  url text;
BEGIN
  -- Try raw_user_meta_data.picture / avatar_url on auth.users
  SELECT COALESCE(
           (raw_user_meta_data ->> 'avatar_url'),
           (raw_user_meta_data ->> 'picture')
         )
    INTO url
  FROM auth.users
  WHERE id = auth_user;

  IF url IS NOT NULL AND length(trim(url)) > 0 THEN
    RETURN url;
  END IF;

  -- Try identities.identity_data.picture for Google
  SELECT i.identity_data ->> 'picture'
    INTO url
  FROM auth.identities i
  WHERE i.user_id = auth_user
    AND i.provider = 'google'
  ORDER BY i.last_sign_in_at DESC NULLS LAST
  LIMIT 1;

  IF url IS NOT NULL AND length(trim(url)) > 0 THEN
    RETURN url;
  END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."get_auth_avatar_url"("auth_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_organization_members"("org_id" "uuid") RETURNS TABLE("id" "uuid", "organization_id" "uuid", "user_id" "uuid", "role" "text", "created_at" timestamp with time zone, "user_email" "text", "user_full_name" "text", "user_avatar_url" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    om.id, 
    om.organization_id, 
    om.user_id,
    om.role,
    om.created_at,
    p.email,
    p.full_name,
    p.avatar_url
  FROM 
    organization_members om
  JOIN 
    profiles p ON om.user_id = p.id
  WHERE 
    om.organization_id = org_id
  ORDER BY 
    om.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_organization_members"("org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_attendees"("p_project_id" "uuid") RETURNS TABLE("signup_id" "uuid", "schedule_id" "text", "user_id" "uuid", "full_name" "text", "username" "text", "avatar_url" "text", "volunteer_comment" "text", "is_anonymous" boolean, "anonymous_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_show_publicly boolean;
  v_visibility text;
BEGIN
  -- Check if project exists and has show_attendees_publicly enabled
  SELECT 
    p.show_attendees_publicly,
    p.visibility
  INTO v_show_publicly, v_visibility
  FROM projects p
  WHERE p.id = p_project_id;

  -- If project doesn't exist or settings don't allow public display, return empty
  IF NOT FOUND OR NOT v_show_publicly OR v_visibility NOT IN ('public', 'unlisted') THEN
    RETURN;
  END IF;

  -- Return attendee details for approved/attended signups, grouped by schedule_id
  RETURN QUERY
  SELECT 
    ps.id AS signup_id,
    ps.schedule_id,
    ps.user_id,
    COALESCE(prof.full_name, '') AS full_name,
    COALESCE(prof.username, '') AS username,
    COALESCE(prof.avatar_url, '') AS avatar_url,
    COALESCE(ps.volunteer_comment, '') AS volunteer_comment,
    (ps.anonymous_id IS NOT NULL) AS is_anonymous,
    COALESCE(anon.name, '') AS anonymous_name
  FROM project_signups ps
  LEFT JOIN profiles prof ON prof.id = ps.user_id
  LEFT JOIN anonymous_signups anon ON anon.id = ps.anonymous_id
  WHERE ps.project_id = p_project_id
    AND ps.status IN ('approved', 'attended')
  ORDER BY ps.created_at ASC;
END;
$$;


ALTER FUNCTION "public"."get_public_attendees"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_auto_join_on_signup"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'pg_temp'
    AS $$
DECLARE
  user_domain text;
  matching_org record;
BEGIN
  -- Extract domain from email
  user_domain := lower(split_part(NEW.email, '@', 2));
  
  -- Skip if no domain
  IF user_domain IS NULL OR user_domain = '' THEN
    RETURN NEW;
  END IF;

  -- Find organization with matching auto_join_domain
  SELECT id, name INTO matching_org
  FROM public.organizations
  WHERE auto_join_domain = user_domain
  LIMIT 1;

  -- If matching org found, add user as member
  IF matching_org.id IS NOT NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role, joined_at)
    VALUES (matching_org.id, NEW.id, 'member', timezone('utc', now()))
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    -- Update user metadata to store auto-joined org info
    UPDATE auth.users
    SET raw_user_meta_data = 
      CASE 
        WHEN raw_user_meta_data IS NULL THEN 
          jsonb_build_object('auto_joined_org_id', matching_org.id, 'auto_joined_org_name', matching_org.name)
        ELSE 
          raw_user_meta_data || jsonb_build_object('auto_joined_org_id', matching_org.id, 'auto_joined_org_name', matching_org.name)
      END
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_auto_join_on_signup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- Pull optional fields from auth user metadata
  -- Note: raw_user_meta_data is a jsonb column on auth.users
  insert into public.profiles (id, email, phone, full_name, username, created_at, updated_at)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce((new.raw_user_meta_data->>'full_name')::text, null),
    coalesce((new.raw_user_meta_data->>'username')::text, null),
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (id) do update
    set email = excluded.email,
        phone = excluded.phone,
        -- only set these if they are provided via metadata; otherwise keep existing
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        username = coalesce(excluded.username, public.profiles.username),
        updated_at = timezone('utc', now());

  insert into public.notification_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_organizer"("p_project_id" "uuid", "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    p_user is not null
    and exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and (
          p.creator_id = p_user
          or exists (
            select 1
            from public.organization_members om
            where om.organization_id = p.organization_id
              and om.user_id = p_user
              and om.role in ('admin', 'staff')
          )
        )
    ),
    false
  );
$$;


ALTER FUNCTION "public"."is_project_organizer"("p_project_id" "uuid", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_super_admin')::boolean, false);
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_trusted_member"("p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    coalesce((
      select p.trusted_member
      from public.profiles p
      where p.id = p_user
    ), false)
    or exists (
      select 1
      from public.trusted_member tm
      where tm.user_id = p_user
        and tm.status is true
    );
$$;


ALTER FUNCTION "public"."is_trusted_member"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_trusted_member_edit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  allow_sync text;
  claims jsonb;
  is_admin boolean := false;
BEGIN
  -- Bypass when called from the trusted_member sync
  allow_sync := current_setting('app.allow_trusted_sync', true);
  IF allow_sync = 'true' THEN
    RETURN NEW;
  END IF;

  -- Optional: allow service-role to perform admin maintenance
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Optional: allow super admins via JWT claim, if present
  claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  IF claims ? 'is_super_admin' THEN
    is_admin := COALESCE((claims->>'is_super_admin')::boolean, false);
  END IF;
  IF is_admin THEN
    RETURN NEW;
  END IF;

  -- Enforce: block direct edits to trusted_member
  IF TG_OP = 'UPDATE' AND NEW.trusted_member IS DISTINCT FROM OLD.trusted_member THEN
    RAISE EXCEPTION 'Editing column "trusted_member" is not allowed';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.trusted_member IS NOT NULL THEN
    RAISE EXCEPTION 'Editing column "trusted_member" is not allowed';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_trusted_member_edit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_projects"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    project RECORD;
    now TIMESTAMP WITH TIME ZONE := timezone('PST', NOW());
    start_date TIMESTAMP WITH TIME ZONE;
    end_date TIMESTAMP WITH TIME ZONE;
BEGIN
    FOR project IN SELECT * FROM public.projects WHERE status IN ('in-progress', 'upcoming') LOOP
        -- Determine start date
        IF project.event_type = 'oneTime' THEN
            start_date := timezone('PST', (project.schedule->'oneTime'->>'date')::timestamp + (project.schedule->'oneTime'->>'startTime')::time);
            end_date := timezone('PST', (project.schedule->'oneTime'->>'date')::timestamp + (project.schedule->'oneTime'->>'endTime')::time);
        ELSIF project.event_type = 'multiDay' THEN
            -- Calculate start and end times based on slots
            start_date := (SELECT MIN(timezone('PST', (day->>'date')::timestamp + (slot->>'startTime')::time))
                                   FROM jsonb_array_elements(project.schedule->'multiDay') AS day,
                                        jsonb_array_elements(day->'slots') AS slot);
            end_date := (SELECT MAX(timezone('PST', (day->>'date')::timestamp + (slot->>'endTime')::time))
                             FROM jsonb_array_elements(project.schedule->'multiDay') AS day,
                                  jsonb_array_elements(day->'slots') AS slot);
        ELSIF project.event_type = 'sameDayMultiArea' THEN
            -- Calculate start and end times based on roles
            start_date := timezone('PST', (project.schedule->'sameDayMultiArea'->>'date')::timestamp + (project.schedule->'sameDayMultiArea'->>'overallStart')::time);
            end_date := timezone('PST', (project.schedule->'sameDayMultiArea'->>'date')::timestamp + (project.schedule->'sameDayMultiArea'->>'overallEnd')::time);
            
            -- Find the earliest start time and latest end time from roles
            start_date := LEAST(start_date, (SELECT MIN(timezone('PST', (project.schedule->'sameDayMultiArea'->>'date')::timestamp + (role->>'startTime')::time))
                                               FROM jsonb_array_elements(project.schedule->'sameDayMultiArea'->'roles') AS role));
            end_date := GREATEST(end_date, (SELECT MAX(timezone('PST', (project.schedule->'sameDayMultiArea'->>'date')::timestamp + (role->>'endTime')::time))
                                             FROM jsonb_array_elements(project.schedule->'sameDayMultiArea'->'roles') AS role));
        ELSE
            RAISE EXCEPTION 'Invalid event type';
        END IF;

        -- Determine project status
        IF project.status = 'cancelled' THEN
            CONTINUE; -- Skip cancelled projects
        ELSIF now > end_date THEN
            -- Project is completed
            UPDATE public.projects SET status = 'completed' WHERE id = project.id;
        ELSIF now >= start_date AND now <= end_date THEN
            -- Project is in-progress
            UPDATE public.projects SET status = 'in-progress' WHERE id = project.id;
        ELSE
            -- Project is upcoming
            UPDATE public.projects SET status = 'upcoming' WHERE id = project.id;
        END IF;
    END LOOP;
END;
$$;


ALTER FUNCTION "public"."process_projects"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profiles_block_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  -- Allow sync path only
  IF TG_OP = 'UPDATE'
     AND NEW.trusted_member IS DISTINCT FROM OLD.trusted_member
     AND COALESCE(current_setting('app.allow_trusted_member_sync', true), 'false') <> 'true'
  THEN
    RAISE EXCEPTION 'Editing column "trusted_member" is not allowed';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."profiles_block_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profiles_set_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'auth', 'pg_temp'
    AS $$
BEGIN
  -- Username logic (reuse generator)
  IF NEW.username IS NULL OR length(trim(NEW.username)) = 0 THEN
    NEW.username := public.gen_unique_username('');
  ELSE
    NEW.username := regexp_replace(lower(NEW.username), '[^a-z0-9_]+', '', 'g');
    IF NEW.username IS NULL OR NEW.username = '' THEN
      NEW.username := public.gen_unique_username('');
    END IF;
  END IF;

  -- Avatar logic: set only if null/empty
  IF NEW.avatar_url IS NULL OR length(trim(NEW.avatar_url)) = 0 THEN
    NEW.avatar_url := public.get_auth_avatar_url(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."profiles_set_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profiles_set_username"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.username IS NULL OR length(trim(NEW.username)) = 0 THEN
    NEW.username := public.gen_unique_username('');
  ELSE
    -- enforce lowercase and allowed chars if provided; if becomes empty, generate
    NEW.username := regexp_replace(lower(NEW.username), '[^a-z0-9_]+', '', 'g');
    IF NEW.username IS NULL OR NEW.username = '' THEN
      NEW.username := public.gen_unique_username('');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."profiles_set_username"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_system_banners_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;


ALTER FUNCTION "public"."set_system_banners_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_profiles_trusted_from_tm"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Allow the profiles trigger to accept this change
  PERFORM set_config('app.allow_trusted_sync', 'true', true);

  UPDATE public.profiles
  SET trusted_member = NEW.status
  WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_profiles_trusted_from_tm"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_tm_from_profiles_trusted"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  -- Only act when trusted_member actually changes value (including NULL->true/false)
  IF (TG_OP = 'UPDATE' AND NEW.trusted_member IS DISTINCT FROM OLD.trusted_member)
     OR (TG_OP = 'INSERT' AND NEW.trusted_member IS NOT NULL)
  THEN
    INSERT INTO public.trusted_member (user_id, status)
    VALUES (NEW.id, NEW.trusted_member)
    ON CONFLICT (user_id)
    DO UPDATE SET status = EXCLUDED.status;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_tm_from_profiles_trusted"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_trusted_member_to_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  prev_flag text;
BEGIN
  prev_flag := current_setting('app.allow_trusted_member_sync', true);
  PERFORM set_config('app.allow_trusted_member_sync', 'true', true);

  UPDATE public.profiles
  SET trusted_member = NEW.status
  WHERE id = COALESCE(NEW.user_id, NEW.id);

  IF prev_flag IS NULL THEN
    PERFORM set_config('app.allow_trusted_member_sync', '', true);
  ELSE
    PERFORM set_config('app.allow_trusted_member_sync', prev_flag, true);
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_trusted_member_to_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_user_email_to_custom_table"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'pg_temp'
    AS $$
begin
  insert into public.user_emails (user_id, email, is_primary, verified_at)
  values (new.id, new.email, true, now())
  on conflict (user_id, email) do update
  set is_primary = true, verified_at = now();
  
  update public.user_emails
  set is_primary = false
  where user_id = new.id and email != new.email;
  
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_user_email_to_custom_table"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trusted_member_set_user_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- Allow service role inserts if user_id is provided
  if auth.role() = 'service_role' then
    if new.user_id is null then
      raise exception 'Authentication required';
    end if;
    if new.id is null then
      new.id := new.user_id;
    end if;
    return new;
  end if;

  -- Require an authenticated user
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- Set owner
  new.user_id := auth.uid();
  if new.id is null then
    new.id := auth.uid();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trusted_member_set_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profile_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
    -- Fully‑qualified reference (already qualified)
    UPDATE public.profiles
    SET    email = NEW.email
    WHERE  id    = NEW.id;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_profile_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profile_email"("p_user_id" "uuid", "p_new_email" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
    -- Fully‑qualified references required:
    UPDATE public.profiles
    SET email = p_new_email,
        updated_at = now()
    WHERE id = p_user_id;

    -- If you also modify auth tables, qualify them:
    UPDATE auth.users
    SET email = p_new_email
    WHERE id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."update_profile_email"("p_user_id" "uuid", "p_new_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_project_draft_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_project_draft_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_project_draft_updated_at"("project_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.projects
  SET draft_updated_at = now()
  WHERE id = project_id;
END;
$$;


ALTER FUNCTION "public"."update_project_draft_updated_at"("project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_profile_picture"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
    -- When a new profile picture is uploaded
    IF TG_OP = 'INSERT' THEN
        UPDATE auth.users
        SET avatar_url = NEW.name, -- Adjust this based on your actual column name
            profile_picture_path = NEW.metadata->>'path' -- Adjust this based on your actual metadata structure
        WHERE id = NEW.owner_id::uuid; -- Cast to UUID if necessary

    -- When a profile picture is deleted or updated
    ELSIF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
        DELETE FROM storage.objects
        WHERE name = OLD.name; -- Assuming 'name' is the identifier

        -- If it's an update, we also need to update the user's profile picture
        IF TG_OP = 'UPDATE' THEN
            UPDATE auth.users
            SET avatar_url = NEW.name, -- Adjust this based on your actual column name
                profile_picture_path = NEW.metadata->>'path' -- Adjust this based on your actual metadata structure
            WHERE id = NEW.owner_id::uuid; -- Cast to UUID if necessary
        END IF;
    END IF;

    RETURN NULL; -- Triggers that do not modify the row must return NULL
END;
$$;


ALTER FUNCTION "public"."update_user_profile_picture"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_profile_picture"("user_id" bigint, "picture_url" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
    -- Set a fixed search path
    SET search_path TO public;

    -- Function logic to update the user's profile picture
    UPDATE users SET profile_picture = picture_url WHERE id = user_id;
END;
$$;


ALTER FUNCTION "public"."update_user_profile_picture"("user_id" bigint, "picture_url" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."account_data_export_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid",
    "user_id" "uuid",
    "event_type" "text" NOT NULL,
    "status" "text" NOT NULL,
    "source" "text" DEFAULT 'system'::"text" NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "account_data_export_audit_logs_status_check" CHECK (("status" = ANY (ARRAY['info'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."account_data_export_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_data_export_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "requested_by" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "delivery_method" "text" DEFAULT 'email'::"text" NOT NULL,
    "delivery_email" "text" NOT NULL,
    "storage_path" "text",
    "signed_url" "text",
    "signed_url_expires_at" timestamp with time zone,
    "record_count" integer DEFAULT 0 NOT NULL,
    "datasets_count" integer DEFAULT 0 NOT NULL,
    "zip_size_bytes" bigint,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "error_message" "text",
    "request_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "export_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "account_data_export_jobs_delivery_method_check" CHECK (("delivery_method" = 'email'::"text")),
    CONSTRAINT "account_data_export_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."account_data_export_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anonymous_signups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "token" "uuid" DEFAULT "gen_random_uuid"(),
    "email" "text",
    "name" "text",
    "phone_number" "text",
    "confirmed_at" timestamp with time zone,
    "linked_user_id" "uuid"
);


ALTER TABLE "public"."anonymous_signups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."banned_emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "reason" "text",
    "banned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "banned_by" "uuid"
);


ALTER TABLE "public"."banned_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."certificates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_title" "text" NOT NULL,
    "creator_name" "text",
    "is_certified" boolean NOT NULL,
    "event_start" timestamp with time zone NOT NULL,
    "event_end" timestamp with time zone NOT NULL,
    "volunteer_email" "text",
    "user_id" "uuid",
    "check_in_method" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "organization_name" "text",
    "project_id" "uuid",
    "schedule_id" "text",
    "issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "signup_id" "uuid",
    "volunteer_name" "text",
    "project_location" "text",
    "creator_id" "uuid",
    "type" "text",
    "description" "text"
);


ALTER TABLE "public"."certificates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_type" character varying(50) NOT NULL,
    "content_id" "uuid" NOT NULL,
    "content_url" "text",
    "flag_type" character varying(50) NOT NULL,
    "flag_source" character varying(50),
    "confidence_score" numeric(5,4),
    "flagged_categories" "jsonb",
    "flag_details" "jsonb",
    "status" character varying(50) DEFAULT 'pending'::character varying,
    "auto_action" character varying(50),
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."content_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_id" "uuid",
    "content_type" character varying(50) NOT NULL,
    "content_id" "uuid" NOT NULL,
    "reason" character varying(100) NOT NULL,
    "description" "text" NOT NULL,
    "status" character varying(50) DEFAULT 'pending'::character varying,
    "priority" character varying(20) DEFAULT 'normal'::character varying,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "resolution_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "ai_metadata" "jsonb"
);


ALTER TABLE "public"."content_reports" OWNER TO "postgres";


COMMENT ON COLUMN "public"."content_reports"."ai_metadata" IS 'Structured AI moderation analysis: { triagedAt, verdict, reasoning, reasoningSteps[], confidence, priority, suggestedStatus, recommendedAction, tags[], toolsUsed[], shortSummary }';



CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "section" "text" NOT NULL,
    "email" "text" NOT NULL,
    "title" "text" NOT NULL,
    "feedback" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "page_path" "text",
    "metadata" "jsonb",
    CONSTRAINT "feedback_section_check" CHECK (("section" = ANY (ARRAY['issue'::"text", 'idea'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_settings" (
    "user_id" "uuid" NOT NULL,
    "email_notifications" boolean DEFAULT true,
    "project_updates" boolean DEFAULT true,
    "general" boolean DEFAULT true
);


ALTER TABLE "public"."notification_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."notification_settings"."general" IS 'general settings and application stuff';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "type" "text" NOT NULL,
    "read" boolean DEFAULT false,
    "data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "action_url" "text",
    "displayed" boolean DEFAULT false,
    "severity" "text" DEFAULT 'info'::"text"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."notifications" IS '@realtime=true';



CREATE TABLE IF NOT EXISTS "public"."organization_calendar_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "schedule_id" "text" NOT NULL,
    "event_id" "text" NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."organization_calendar_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_calendar_syncs" (
    "organization_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "calendar_id" "text",
    "calendar_email" "text",
    "connected_at" timestamp with time zone DEFAULT "now"(),
    "last_synced_at" timestamp with time zone,
    "auto_sync" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."organization_calendar_syncs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" character varying NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"(),
    "can_verify_hours" boolean DEFAULT true,
    "status" "text" DEFAULT 'active'::"text",
    "last_activity_at" timestamp without time zone,
    "is_visible" boolean DEFAULT true,
    CONSTRAINT "organization_members_role_check" CHECK ((("role")::"text" = ANY (ARRAY[('admin'::character varying)::"text", ('staff'::character varying)::"text", ('member'::character varying)::"text"])))
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_sheet_syncs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "sheet_id" "text" NOT NULL,
    "sheet_url" "text" NOT NULL,
    "tab_name" "text" DEFAULT 'Member Hours'::"text" NOT NULL,
    "report_type" "text" DEFAULT 'member-hours'::"text" NOT NULL,
    "auto_sync" boolean DEFAULT false NOT NULL,
    "sync_interval_minutes" integer DEFAULT 1440 NOT NULL,
    "last_synced_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sheet_title" "text",
    "range_a1" "text",
    "layout_config" "jsonb"
);


ALTER TABLE "public"."organization_sheet_syncs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."organization_sheet_syncs"."layout_config" IS 'Flexible layout configuration for sheet sync. Contains orientation, column selection, and ordering. Example: {"orientation":"horizontal","columns":[{"key":"volunteer_name","label":"Name"},...]}';



CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" character varying NOT NULL,
    "username" character varying NOT NULL,
    "description" "text",
    "website" character varying,
    "logo_url" character varying,
    "type" "text" NOT NULL,
    "join_code" character varying(6) NOT NULL,
    "verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "staff_join_token" "uuid",
    "staff_join_token_created_at" timestamp with time zone,
    "staff_join_token_expires_at" timestamp with time zone,
    "auto_join_domain" "text",
    "allowed_email_domains" "text",
    CONSTRAINT "organizations_type_check" CHECK (("type" = ANY (ARRAY[('nonprofit'::character varying)::"text", ('school'::character varying)::"text", ('company'::character varying)::"text", ('other'::character varying)::"text"])))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "phone" "text",
    "email" character varying,
    "volunteer_goals" "jsonb",
    "trusted_member" boolean,
    "profile_visibility" character varying(20) DEFAULT 'public'::character varying,
    CONSTRAINT "profiles_profile_visibility_check" CHECK ((("profile_visibility")::"text" = ANY (ARRAY[('public'::character varying)::"text", ('private'::character varying)::"text", ('organization_only'::character varying)::"text"]))),
    CONSTRAINT "username_lowercase" CHECK (("username" = "lower"("username")))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."profile_visibility" IS 'Controls who can view this profile: public, private, or organization_only';



CREATE TABLE IF NOT EXISTS "public"."project_cancellation_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "cancelled_at" timestamp with time zone NOT NULL,
    "cancellation_reason" "text" NOT NULL,
    "created_by" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "cursor" integer DEFAULT 0 NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processing_started_at" timestamp with time zone,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."project_cancellation_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_drafts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text",
    "draft_data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."project_drafts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_signups" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "project_id" "uuid",
    "user_id" "uuid",
    "schedule_id" "text" NOT NULL,
    "status" "text" DEFAULT '''pending''::text'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "anonymous_id" "uuid",
    "check_in_time" timestamp with time zone,
    "check_out_time" timestamp with time zone,
    "volunteer_calendar_event_id" "text",
    "volunteer_synced_at" timestamp with time zone,
    "volunteer_comment" "text",
    CONSTRAINT "project_signups_status_check" CHECK (("status" = ANY (ARRAY['approved'::"text", 'attended'::"text", 'rejected'::"text", 'pending'::"text"]))),
    CONSTRAINT "user_or_anonymous" CHECK (((("user_id" IS NOT NULL) AND ("anonymous_id" IS NULL)) OR (("user_id" IS NULL) AND ("anonymous_id" IS NOT NULL))))
);


ALTER TABLE "public"."project_signups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "creator_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "location" "text" NOT NULL,
    "description" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "verification_method" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "schedule" "jsonb" NOT NULL,
    "status" "text" DEFAULT '''upcoming''::text'::"text",
    "require_login" boolean DEFAULT true NOT NULL,
    "cover_image_url" "text",
    "documents" "jsonb" DEFAULT '[]'::"jsonb",
    "organization_id" "uuid",
    "cancellation_reason" "text",
    "cancelled_at" timestamp with time zone,
    "location_data" "jsonb",
    "pause_signups" boolean DEFAULT false NOT NULL,
    "session_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "published" "jsonb",
    "creator_calendar_event_id" "text",
    "creator_synced_at" timestamp with time zone,
    "project_timezone" "text" DEFAULT 'America/Los_Angeles'::"text",
    "restrict_to_org_domains" boolean DEFAULT false,
    "visibility" "text" DEFAULT 'public'::"text",
    "can_be_managed_by_staff" boolean DEFAULT true,
    "workflow_status" "text" DEFAULT 'published'::"text",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp without time zone,
    "review_notes" "text",
    "enable_volunteer_comments" boolean DEFAULT false NOT NULL,
    "show_attendees_publicly" boolean DEFAULT false NOT NULL,
    "recurrence_rule" "jsonb",
    "recurrence_parent_id" "uuid",
    "recurrence_sequence" integer,
    "waiver_required" boolean DEFAULT false,
    "waiver_allow_upload" boolean DEFAULT true,
    "waiver_pdf_storage_path" "text",
    "waiver_pdf_url" "text",
    "waiver_definition_id" "uuid",
    "waiver_disable_esignature" boolean DEFAULT false NOT NULL,
    "recurrence_occurrence_date" "date",
    CONSTRAINT "projects_visibility_check" CHECK (("visibility" = ANY (ARRAY['public'::"text", 'unlisted'::"text", 'organization_only'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


COMMENT ON COLUMN "public"."projects"."waiver_definition_id" IS 'References the active waiver definition for this project (nullable for backward compatibility)';



CREATE OR REPLACE VIEW "public"."projects_with_creator" WITH ("security_invoker"='true') AS
 SELECT "p"."id",
    "p"."creator_id",
    "p"."title",
    "p"."location",
    "p"."description",
    "p"."event_type",
    "p"."verification_method",
    "p"."created_at",
    "p"."schedule",
    "p"."status",
    "p"."require_login",
    "p"."cover_image_url",
    "p"."documents",
    "p"."organization_id",
    "p"."cancellation_reason",
    "p"."cancelled_at",
    "p"."location_data",
    "p"."pause_signups",
    "p"."session_id",
    "p"."published",
    "p"."creator_calendar_event_id",
    "p"."creator_synced_at",
    "p"."project_timezone",
    "p"."restrict_to_org_domains",
    "p"."visibility",
    "p"."can_be_managed_by_staff",
    "p"."workflow_status",
    "p"."reviewed_by",
    "p"."reviewed_at",
    "p"."review_notes",
    "p"."enable_volunteer_comments",
    "p"."show_attendees_publicly",
    "p"."recurrence_rule",
    "p"."recurrence_parent_id",
    "p"."recurrence_sequence",
    "pr"."full_name" AS "creator_full_name",
    "pr"."avatar_url" AS "creator_avatar_url",
    "pr"."username" AS "creator_username"
   FROM ("public"."projects" "p"
     LEFT JOIN "public"."profiles" "pr" ON (("pr"."id" = "p"."creator_id")));


ALTER VIEW "public"."projects_with_creator" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_banners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text",
    "message" "text" NOT NULL,
    "banner_type" "text" DEFAULT 'info'::"text" NOT NULL,
    "target_scope" "text" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "cta_label" "text",
    "cta_url" "text",
    "dismissible" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "show_icon" boolean DEFAULT true NOT NULL,
    "text_align" "text" DEFAULT 'center'::"text" NOT NULL,
    CONSTRAINT "system_banners_banner_type_check" CHECK (("banner_type" = ANY (ARRAY['info'::"text", 'success'::"text", 'warning'::"text", 'outage'::"text"]))),
    CONSTRAINT "system_banners_cta_label_length" CHECK ((("cta_label" IS NULL) OR ("char_length"("cta_label") <= 40))),
    CONSTRAINT "system_banners_message_length" CHECK ((("char_length"("message") >= 1) AND ("char_length"("message") <= 1000))),
    CONSTRAINT "system_banners_target_scope_check" CHECK (("target_scope" = ANY (ARRAY['sitewide'::"text", 'landing'::"text"]))),
    CONSTRAINT "system_banners_text_align_check" CHECK (("text_align" = ANY (ARRAY['left'::"text", 'center'::"text", 'right'::"text"]))),
    CONSTRAINT "system_banners_time_window" CHECK ((("ends_at" IS NULL) OR ("starts_at" IS NULL) OR ("ends_at" >= "starts_at"))),
    CONSTRAINT "system_banners_title_length" CHECK ((("title" IS NULL) OR ("char_length"("title") <= 120)))
);


ALTER TABLE "public"."system_banners" OWNER TO "postgres";


COMMENT ON TABLE "public"."system_banners" IS 'Admin-managed sticky banners for sitewide and landing announcements.';



CREATE TABLE IF NOT EXISTS "public"."trusted_member" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text",
    "email" "text",
    "reason" "text",
    "status" boolean,
    "id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."trusted_member" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_calendar_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT 'google'::"text" NOT NULL,
    "access_token" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "token_expires_at" timestamp with time zone NOT NULL,
    "calendar_email" "text" NOT NULL,
    "connected_at" timestamp with time zone DEFAULT "now"(),
    "last_synced_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "preferences" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "granted_scopes" "text",
    "granted_scopes_updated_at" timestamp with time zone,
    "connection_type" character varying(50) DEFAULT 'calendar'::character varying,
    CONSTRAINT "user_calendar_connections_connection_type_check" CHECK ((("connection_type")::"text" = ANY ((ARRAY['calendar'::character varying, 'sheets'::character varying, 'both'::character varying])::"text"[])))
);


ALTER TABLE "public"."user_calendar_connections" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_calendar_connections"."connection_type" IS 'Type of OAuth connection: calendar for Google Calendar, sheets for Google Sheets, both for both';



CREATE TABLE IF NOT EXISTS "public"."user_emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "is_primary" boolean DEFAULT false,
    "verified_at" timestamp with time zone,
    "verification_token" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."waiver_definition_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "waiver_definition_id" "uuid" NOT NULL,
    "field_key" "text" NOT NULL,
    "field_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "required" boolean DEFAULT false NOT NULL,
    "source" "text" NOT NULL,
    "pdf_field_name" "text",
    "page_index" integer NOT NULL,
    "rect" "jsonb" NOT NULL,
    "signer_role_key" "text",
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "waiver_definition_fields_field_type_check" CHECK (("field_type" = ANY (ARRAY['signature'::"text", 'name'::"text", 'date'::"text", 'email'::"text", 'phone'::"text", 'address'::"text", 'text'::"text", 'checkbox'::"text", 'radio'::"text", 'dropdown'::"text", 'initial'::"text"]))),
    CONSTRAINT "waiver_definition_fields_source_check" CHECK (("source" = ANY (ARRAY['pdf_widget'::"text", 'custom_overlay'::"text"])))
);


ALTER TABLE "public"."waiver_definition_fields" OWNER TO "postgres";


COMMENT ON TABLE "public"."waiver_definition_fields" IS 'Defines signature placements, form fields, and their positions within a waiver PDF';



COMMENT ON COLUMN "public"."waiver_definition_fields"."field_key" IS 'Unique identifier for this field within the waiver';



COMMENT ON COLUMN "public"."waiver_definition_fields"."field_type" IS 'Type of field (signature, text input, checkbox, etc.)';



COMMENT ON COLUMN "public"."waiver_definition_fields"."source" IS 'Whether this field comes from a PDF form widget or is a custom overlay';



COMMENT ON COLUMN "public"."waiver_definition_fields"."pdf_field_name" IS 'Name of the PDF form field (if source is pdf_widget)';



COMMENT ON COLUMN "public"."waiver_definition_fields"."page_index" IS 'Zero-based page index where this field appears';



COMMENT ON COLUMN "public"."waiver_definition_fields"."rect" IS 'JSONB object with field coordinates: {x, y, width, height}';



COMMENT ON COLUMN "public"."waiver_definition_fields"."signer_role_key" IS 'Associates this field with a specific signer role (optional)';



COMMENT ON COLUMN "public"."waiver_definition_fields"."meta" IS 'Additional metadata (e.g., validation rules, default values, options for dropdowns)';



CREATE TABLE IF NOT EXISTS "public"."waiver_definition_signers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "waiver_definition_id" "uuid" NOT NULL,
    "role_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "required" boolean DEFAULT true NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "rules" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."waiver_definition_signers" OWNER TO "postgres";


COMMENT ON TABLE "public"."waiver_definition_signers" IS 'Defines the roles that must sign a waiver (e.g., Volunteer, Parent, Student)';



COMMENT ON COLUMN "public"."waiver_definition_signers"."role_key" IS 'Unique identifier for this signer role within the waiver (e.g., "volunteer", "parent")';



COMMENT ON COLUMN "public"."waiver_definition_signers"."label" IS 'Human-readable label for this signer role';



COMMENT ON COLUMN "public"."waiver_definition_signers"."order_index" IS 'Determines the order in which signers should appear in the UI';



COMMENT ON COLUMN "public"."waiver_definition_signers"."rules" IS 'Optional JSONB field for role-specific rules (e.g., age restrictions, relationship requirements)';



CREATE TABLE IF NOT EXISTS "public"."waiver_definitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope" "text" NOT NULL,
    "project_id" "uuid",
    "title" "text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "active" boolean DEFAULT false NOT NULL,
    "pdf_storage_path" "text",
    "pdf_public_url" "text",
    "source" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "waiver_def_scope_project" CHECK (((("scope" = 'project'::"text") AND ("project_id" IS NOT NULL)) OR (("scope" = 'global'::"text") AND ("project_id" IS NULL)))),
    CONSTRAINT "waiver_definitions_scope_check" CHECK (("scope" = ANY (ARRAY['project'::"text", 'global'::"text"]))),
    CONSTRAINT "waiver_definitions_source_check" CHECK (("source" = ANY (ARRAY['project_pdf'::"text", 'global_pdf'::"text", 'rich_text'::"text"])))
);


ALTER TABLE "public"."waiver_definitions" OWNER TO "postgres";


COMMENT ON TABLE "public"."waiver_definitions" IS 'Stores configured waiver templates with support for project-specific and global scopes';



COMMENT ON COLUMN "public"."waiver_definitions"."scope" IS 'Determines if this waiver is project-specific or global';



COMMENT ON COLUMN "public"."waiver_definitions"."pdf_storage_path" IS 'Internal storage path for the PDF file (if applicable)';



COMMENT ON COLUMN "public"."waiver_definitions"."pdf_public_url" IS 'Public URL for accessing the PDF';



COMMENT ON COLUMN "public"."waiver_definitions"."source" IS 'Indicates whether the waiver comes from a project PDF, global PDF, or rich text editor';



CREATE TABLE IF NOT EXISTS "public"."waiver_signatures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "waiver_template_id" "uuid",
    "project_id" "uuid" NOT NULL,
    "signup_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "anonymous_id" "uuid",
    "signer_name" "text" NOT NULL,
    "signer_email" "text" NOT NULL,
    "signature_type" "text" NOT NULL,
    "signature_text" "text",
    "signature_storage_path" "text",
    "upload_storage_path" "text",
    "signed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "expires_at" timestamp with time zone DEFAULT ("now"() + '90 days'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "form_data" "jsonb",
    "waiver_pdf_url" "text",
    "waiver_definition_id" "uuid",
    "signature_payload" "jsonb",
    CONSTRAINT "waiver_signatures_signature_type_check" CHECK (("signature_type" = ANY (ARRAY['draw'::"text", 'typed'::"text", 'upload'::"text", 'multi-signer'::"text"])))
);


ALTER TABLE "public"."waiver_signatures" OWNER TO "postgres";


COMMENT ON TABLE "public"."waiver_signatures" IS 'Stores waiver signature records with support for both legacy signatures and new multi-signer system';



COMMENT ON COLUMN "public"."waiver_signatures"."waiver_definition_id" IS 'References the waiver definition used for this signature (nullable for backward compatibility with legacy signatures)';



COMMENT ON COLUMN "public"."waiver_signatures"."signature_payload" IS 'Stores multi-signer signature data for on-demand PDF generation. Schema: {signers: [{role_key, method, data, timestamp}], fields: {field_key: value}}';



CREATE TABLE IF NOT EXISTS "public"."waiver_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."waiver_templates" OWNER TO "postgres";


ALTER TABLE ONLY "public"."anonymous_signups"
    ADD CONSTRAINT "a_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."account_data_export_audit_logs"
    ADD CONSTRAINT "account_data_export_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."account_data_export_jobs"
    ADD CONSTRAINT "account_data_export_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."banned_emails"
    ADD CONSTRAINT "banned_emails_email_unique" UNIQUE ("email");



ALTER TABLE ONLY "public"."banned_emails"
    ADD CONSTRAINT "banned_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_flags"
    ADD CONSTRAINT "content_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_calendar_events"
    ADD CONSTRAINT "organization_calendar_events_organization_id_project_id_sch_key" UNIQUE ("organization_id", "project_id", "schedule_id");



ALTER TABLE ONLY "public"."organization_calendar_events"
    ADD CONSTRAINT "organization_calendar_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_calendar_syncs"
    ADD CONSTRAINT "organization_calendar_syncs_pkey" PRIMARY KEY ("organization_id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_user_id_key" UNIQUE ("organization_id", "user_id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_sheet_syncs"
    ADD CONSTRAINT "organization_sheet_syncs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_staff_join_token_key" UNIQUE ("staff_join_token");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."project_cancellation_jobs"
    ADD CONSTRAINT "project_cancellation_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_cancellation_jobs"
    ADD CONSTRAINT "project_cancellation_jobs_project_id_key" UNIQUE ("project_id");



ALTER TABLE ONLY "public"."project_drafts"
    ADD CONSTRAINT "project_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_signups"
    ADD CONSTRAINT "project_signups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_banners"
    ADD CONSTRAINT "system_banners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trusted_member"
    ADD CONSTRAINT "trusted_member_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trusted_member"
    ADD CONSTRAINT "trusted_member_user_id_unique" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."waiver_definition_fields"
    ADD CONSTRAINT "unique_field_key_per_def" UNIQUE ("waiver_definition_id", "field_key");



ALTER TABLE ONLY "public"."waiver_definition_signers"
    ADD CONSTRAINT "unique_signer_role_per_def" UNIQUE ("waiver_definition_id", "role_key");



ALTER TABLE ONLY "public"."user_calendar_connections"
    ADD CONSTRAINT "user_calendar_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_emails"
    ADD CONSTRAINT "user_emails_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."user_emails"
    ADD CONSTRAINT "user_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_emails"
    ADD CONSTRAINT "user_emails_user_id_email_key" UNIQUE ("user_id", "email");



ALTER TABLE ONLY "public"."waiver_definition_fields"
    ADD CONSTRAINT "waiver_definition_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waiver_definition_signers"
    ADD CONSTRAINT "waiver_definition_signers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waiver_definitions"
    ADD CONSTRAINT "waiver_definitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waiver_signatures"
    ADD CONSTRAINT "waiver_signatures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waiver_templates"
    ADD CONSTRAINT "waiver_templates_pkey" PRIMARY KEY ("id");



CREATE INDEX "account_data_export_audit_logs_job_id_idx" ON "public"."account_data_export_audit_logs" USING "btree" ("job_id");



CREATE INDEX "account_data_export_audit_logs_user_id_idx" ON "public"."account_data_export_audit_logs" USING "btree" ("user_id");



CREATE INDEX "account_data_export_jobs_status_requested_at_idx" ON "public"."account_data_export_jobs" USING "btree" ("status", "requested_at");



CREATE INDEX "account_data_export_jobs_user_id_idx" ON "public"."account_data_export_jobs" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_anonymous_signups_email_project" ON "public"."anonymous_signups" USING "btree" ("lower"("email"), "project_id");



CREATE INDEX "idx_anonymous_signups_linked_user" ON "public"."anonymous_signups" USING "btree" ("linked_user_id") WHERE ("linked_user_id" IS NOT NULL);



CREATE INDEX "idx_anonymous_signups_project_id" ON "public"."anonymous_signups" USING "btree" ("project_id");



CREATE INDEX "idx_certificates_creator_id" ON "public"."certificates" USING "btree" ("creator_id");



CREATE INDEX "idx_certificates_project_id" ON "public"."certificates" USING "btree" ("project_id");



CREATE INDEX "idx_certificates_signup_id" ON "public"."certificates" USING "btree" ("signup_id");



CREATE INDEX "idx_certificates_user_id" ON "public"."certificates" USING "btree" ("user_id");



CREATE INDEX "idx_certificates_volunteer_email" ON "public"."certificates" USING "btree" ("lower"("volunteer_email"));



CREATE INDEX "idx_content_reports_reporter_id" ON "public"."content_reports" USING "btree" ("reporter_id");



CREATE INDEX "idx_feedback_user_id" ON "public"."feedback" USING "btree" ("user_id");



CREATE INDEX "idx_notification_settings_user_id" ON "public"."notification_settings" USING "btree" ("user_id");



CREATE INDEX "idx_notifications_displayed" ON "public"."notifications" USING "btree" ("user_id", "displayed") WHERE ("displayed" = false);



CREATE INDEX "idx_notifications_severity" ON "public"."notifications" USING "btree" ("severity");



CREATE INDEX "idx_notifications_type" ON "public"."notifications" USING "btree" ("type");



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_organization_calendar_events_project_id" ON "public"."organization_calendar_events" USING "btree" ("project_id");



CREATE INDEX "idx_organization_calendar_syncs_created_by" ON "public"."organization_calendar_syncs" USING "btree" ("created_by");



CREATE INDEX "idx_organization_members_user_id" ON "public"."organization_members" USING "btree" ("user_id");



CREATE INDEX "idx_organization_sheet_syncs_created_by" ON "public"."organization_sheet_syncs" USING "btree" ("created_by");



CREATE INDEX "idx_organization_sheet_syncs_org_id" ON "public"."organization_sheet_syncs" USING "btree" ("organization_id");



CREATE INDEX "idx_organizations_created_by" ON "public"."organizations" USING "btree" ("created_by");



CREATE INDEX "idx_project_signups_anonymous_id" ON "public"."project_signups" USING "btree" ("anonymous_id");



CREATE INDEX "idx_project_signups_calendar_event" ON "public"."project_signups" USING "btree" ("volunteer_calendar_event_id") WHERE ("volunteer_calendar_event_id" IS NOT NULL);



CREATE INDEX "idx_project_signups_id" ON "public"."project_signups" USING "btree" ("id");



CREATE INDEX "idx_project_signups_project_id" ON "public"."project_signups" USING "btree" ("project_id");



CREATE INDEX "idx_project_signups_user_id" ON "public"."project_signups" USING "btree" ("user_id");



CREATE INDEX "idx_project_signups_user_project" ON "public"."project_signups" USING "btree" ("user_id", "project_id");



CREATE INDEX "idx_projects_creator_id" ON "public"."projects" USING "btree" ("creator_id");



CREATE INDEX "idx_projects_organization_id" ON "public"."projects" USING "btree" ("organization_id");



CREATE UNIQUE INDEX "idx_projects_recurrence_parent_occurrence_date_unique" ON "public"."projects" USING "btree" ("recurrence_parent_id", "recurrence_occurrence_date") WHERE (("recurrence_parent_id" IS NOT NULL) AND ("recurrence_occurrence_date" IS NOT NULL));



CREATE INDEX "idx_projects_reviewed_by" ON "public"."projects" USING "btree" ("reviewed_by");



CREATE INDEX "idx_projects_visibility" ON "public"."projects" USING "btree" ("visibility");



CREATE INDEX "idx_projects_waiver_definition" ON "public"."projects" USING "btree" ("waiver_definition_id") WHERE ("waiver_definition_id" IS NOT NULL);



CREATE INDEX "idx_projects_workflow_status" ON "public"."projects" USING "btree" ("workflow_status");



CREATE INDEX "idx_user_calendar_connections_active" ON "public"."user_calendar_connections" USING "btree" ("user_id", "is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_user_calendar_connections_user_id" ON "public"."user_calendar_connections" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_user_calendar_unique_active" ON "public"."user_calendar_connections" USING "btree" ("user_id", "provider") WHERE ("is_active" = true);



CREATE INDEX "idx_user_oauth_calendar_type" ON "public"."user_calendar_connections" USING "btree" ("user_id", "provider", "connection_type") WHERE ((("connection_type")::"text" = ANY ((ARRAY['calendar'::character varying, 'both'::character varying])::"text"[])) AND ("is_active" = true));



CREATE INDEX "idx_user_oauth_connections_type" ON "public"."user_calendar_connections" USING "btree" ("user_id", "connection_type");



CREATE INDEX "idx_user_oauth_sheets_type" ON "public"."user_calendar_connections" USING "btree" ("user_id", "provider", "connection_type") WHERE ((("connection_type")::"text" = ANY ((ARRAY['sheets'::character varying, 'both'::character varying])::"text"[])) AND ("is_active" = true));



CREATE INDEX "idx_waiver_definition_fields_def" ON "public"."waiver_definition_fields" USING "btree" ("waiver_definition_id");



CREATE INDEX "idx_waiver_definition_fields_signer" ON "public"."waiver_definition_fields" USING "btree" ("signer_role_key") WHERE ("signer_role_key" IS NOT NULL);



CREATE INDEX "idx_waiver_definition_signers_def" ON "public"."waiver_definition_signers" USING "btree" ("waiver_definition_id");



CREATE INDEX "idx_waiver_definitions_active" ON "public"."waiver_definitions" USING "btree" ("active") WHERE ("active" = true);



CREATE INDEX "idx_waiver_definitions_project" ON "public"."waiver_definitions" USING "btree" ("project_id") WHERE ("project_id" IS NOT NULL);



CREATE INDEX "idx_waiver_signatures_anonymous_id" ON "public"."waiver_signatures" USING "btree" ("anonymous_id");



CREATE INDEX "idx_waiver_signatures_definition" ON "public"."waiver_signatures" USING "btree" ("waiver_definition_id") WHERE ("waiver_definition_id" IS NOT NULL);



CREATE INDEX "idx_waiver_signatures_user_id" ON "public"."waiver_signatures" USING "btree" ("user_id");



CREATE INDEX "idx_waiver_signatures_waiver_template_id" ON "public"."waiver_signatures" USING "btree" ("waiver_template_id");



CREATE INDEX "organization_calendar_events_org_id_idx" ON "public"."organization_calendar_events" USING "btree" ("organization_id");



CREATE UNIQUE INDEX "organization_sheet_syncs_org_id_idx" ON "public"."organization_sheet_syncs" USING "btree" ("organization_id");



CREATE INDEX "project_drafts_user_id_idx" ON "public"."project_drafts" USING "btree" ("user_id");



CREATE INDEX "project_signups_schedule_id_idx" ON "public"."project_signups" USING "btree" ("schedule_id");



CREATE INDEX "projects_recurrence_parent_id_idx" ON "public"."projects" USING "btree" ("recurrence_parent_id");



CREATE UNIQUE INDEX "system_banners_one_active_per_scope_idx" ON "public"."system_banners" USING "btree" ("target_scope") WHERE ("is_active" = true);



CREATE INDEX "system_banners_schedule_idx" ON "public"."system_banners" USING "btree" ("starts_at", "ends_at");



CREATE INDEX "system_banners_scope_active_idx" ON "public"."system_banners" USING "btree" ("target_scope", "is_active");



CREATE INDEX "waiver_signatures_project_id_idx" ON "public"."waiver_signatures" USING "btree" ("project_id");



CREATE UNIQUE INDEX "waiver_signatures_signup_id_key" ON "public"."waiver_signatures" USING "btree" ("signup_id");



CREATE OR REPLACE TRIGGER "profiles_set_defaults_bi" BEFORE INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."profiles_set_defaults"();



CREATE OR REPLACE TRIGGER "set_system_banners_updated_at" BEFORE UPDATE ON "public"."system_banners" FOR EACH ROW EXECUTE FUNCTION "public"."set_system_banners_updated_at"();



CREATE OR REPLACE TRIGGER "trg_before_insert_org_member" BEFORE INSERT ON "public"."organization_members" FOR EACH ROW EXECUTE FUNCTION "public"."before_insert_org_member"();



CREATE OR REPLACE TRIGGER "trg_clear_trusted_member_on_delete" AFTER DELETE ON "public"."trusted_member" FOR EACH ROW EXECUTE FUNCTION "public"."clear_trusted_member_on_delete"();



CREATE OR REPLACE TRIGGER "trg_prevent_trusted_member_edit" BEFORE INSERT OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_trusted_member_edit"();



CREATE OR REPLACE TRIGGER "trg_tm_sync_profiles" AFTER INSERT OR UPDATE OF "status" ON "public"."trusted_member" FOR EACH ROW EXECUTE FUNCTION "public"."sync_profiles_trusted_from_tm"();



CREATE OR REPLACE TRIGGER "trusted_member_set_user_id_trg" BEFORE INSERT ON "public"."trusted_member" FOR EACH ROW EXECUTE FUNCTION "public"."trusted_member_set_user_id"();



CREATE OR REPLACE TRIGGER "update_project_drafts_updated_at" BEFORE UPDATE ON "public"."project_drafts" FOR EACH ROW EXECUTE FUNCTION "public"."update_project_draft_updated_at"();



CREATE OR REPLACE TRIGGER "update_user_calendar_connections_updated_at" BEFORE UPDATE ON "public"."user_calendar_connections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."anonymous_signups"
    ADD CONSTRAINT "a_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_data_export_audit_logs"
    ADD CONSTRAINT "account_data_export_audit_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."account_data_export_jobs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."account_data_export_audit_logs"
    ADD CONSTRAINT "account_data_export_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."account_data_export_jobs"
    ADD CONSTRAINT "account_data_export_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."account_data_export_jobs"
    ADD CONSTRAINT "account_data_export_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anonymous_signups"
    ADD CONSTRAINT "anonymous_signups_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."banned_emails"
    ADD CONSTRAINT "banned_emails_banned_by_fkey" FOREIGN KEY ("banned_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_signup_id_fkey" FOREIGN KEY ("signup_id") REFERENCES "public"."project_signups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_calendar_events"
    ADD CONSTRAINT "organization_calendar_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_calendar_events"
    ADD CONSTRAINT "organization_calendar_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_calendar_syncs"
    ADD CONSTRAINT "organization_calendar_syncs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_calendar_syncs"
    ADD CONSTRAINT "organization_calendar_syncs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_profiles_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."organization_sheet_syncs"
    ADD CONSTRAINT "organization_sheet_syncs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_sheet_syncs"
    ADD CONSTRAINT "organization_sheet_syncs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_drafts"
    ADD CONSTRAINT "project_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_signups"
    ADD CONSTRAINT "project_signups_anonymous_id_fkey" FOREIGN KEY ("anonymous_id") REFERENCES "public"."anonymous_signups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_signups"
    ADD CONSTRAINT "project_signups_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_signups"
    ADD CONSTRAINT "project_signups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_signups"
    ADD CONSTRAINT "project_signups_user_id_fkey1" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."project_signups"
    ADD CONSTRAINT "project_signups_user_id_fkey_profiles" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_creator_id_fkey1" FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_recurrence_parent_id_fkey" FOREIGN KEY ("recurrence_parent_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_waiver_definition_id_fkey" FOREIGN KEY ("waiver_definition_id") REFERENCES "public"."waiver_definitions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trusted_member"
    ADD CONSTRAINT "trusted_member_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trusted_member"
    ADD CONSTRAINT "trusted_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_calendar_connections"
    ADD CONSTRAINT "user_calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_emails"
    ADD CONSTRAINT "user_emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_definition_fields"
    ADD CONSTRAINT "waiver_definition_fields_waiver_definition_id_fkey" FOREIGN KEY ("waiver_definition_id") REFERENCES "public"."waiver_definitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_definition_signers"
    ADD CONSTRAINT "waiver_definition_signers_waiver_definition_id_fkey" FOREIGN KEY ("waiver_definition_id") REFERENCES "public"."waiver_definitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_definitions"
    ADD CONSTRAINT "waiver_definitions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."waiver_definitions"
    ADD CONSTRAINT "waiver_definitions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_signatures"
    ADD CONSTRAINT "waiver_signatures_anonymous_id_fkey" FOREIGN KEY ("anonymous_id") REFERENCES "public"."anonymous_signups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."waiver_signatures"
    ADD CONSTRAINT "waiver_signatures_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_signatures"
    ADD CONSTRAINT "waiver_signatures_signup_id_fkey" FOREIGN KEY ("signup_id") REFERENCES "public"."project_signups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_signatures"
    ADD CONSTRAINT "waiver_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."waiver_signatures"
    ADD CONSTRAINT "waiver_signatures_waiver_definition_id_fkey" FOREIGN KEY ("waiver_definition_id") REFERENCES "public"."waiver_definitions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."waiver_signatures"
    ADD CONSTRAINT "waiver_signatures_waiver_template_id_fkey" FOREIGN KEY ("waiver_template_id") REFERENCES "public"."waiver_templates"("id") ON DELETE RESTRICT;



CREATE POLICY "Admins can delete orgs" ON "public"."organizations" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organizations"."id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = 'admin'::"text")))));



CREATE POLICY "Allow admin to update flags" ON "public"."content_flags" FOR UPDATE USING (((( SELECT "auth"."jwt"() AS "jwt") ->> 'role'::"text") = 'admin'::"text")) WITH CHECK (((( SELECT "auth"."jwt"() AS "jwt") ->> 'role'::"text") = 'admin'::"text"));



CREATE POLICY "Allow admin to view flags" ON "public"."content_flags" FOR SELECT USING (((( SELECT "auth"."jwt"() AS "jwt") ->> 'role'::"text") = 'admin'::"text"));



CREATE POLICY "Allow admins to update organizations" ON "public"."organizations" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") IN ( SELECT "organization_members"."user_id"
   FROM "public"."organization_members"
  WHERE (("organization_members"."organization_id" = "organizations"."id") AND (("organization_members"."role")::"text" = 'admin'::"text")))));



CREATE POLICY "Allow anyone to read organization members" ON "public"."organization_members" FOR SELECT USING (true);



CREATE POLICY "Allow anyone to read organizations" ON "public"."organizations" FOR SELECT USING (true);



CREATE POLICY "Anyone can read active waiver templates" ON "public"."waiver_templates" FOR SELECT USING (("active" = true));



CREATE POLICY "Block all client access to cancellation jobs" ON "public"."project_cancellation_jobs" USING (false) WITH CHECK (false);



CREATE POLICY "Block client deletes to waiver templates" ON "public"."waiver_templates" FOR DELETE USING (false);



CREATE POLICY "Block client inserts to waiver templates" ON "public"."waiver_templates" FOR INSERT WITH CHECK (false);



CREATE POLICY "Block client updates to waiver templates" ON "public"."waiver_templates" FOR UPDATE USING (false);



CREATE POLICY "Create org with cooldown" ON "public"."organizations" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = "auth"."uid"()) AND "public"."is_trusted_member"("auth"."uid"()) AND (( SELECT "count"(*) AS "count"
   FROM "public"."organizations" "o2"
  WHERE (("o2"."created_by" = "auth"."uid"()) AND ("o2"."created_at" > ("now"() - '14 days'::interval)))) < 5)));



CREATE POLICY "Enable delete for users based on user_id" ON "public"."profiles" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Enable project creators to delete their projects" ON "public"."projects" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "creator_id"));



CREATE POLICY "Enable project creators to update their projects" ON "public"."projects" FOR UPDATE USING (("auth"."uid"() = "creator_id")) WITH CHECK ((("auth"."uid"() = "creator_id") AND (("visibility" <> 'public'::"text") OR "public"."can_keep_or_set_public_visibility"("id", "auth"."uid"()))));



CREATE POLICY "Insert own or by project owner" ON "public"."notifications" FOR INSERT TO "anon", "authenticated", "authenticator", "dashboard_user" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM ("public"."project_signups" "ps"
     JOIN "public"."projects" "p" ON (("p"."id" = "ps"."project_id")))
  WHERE (("ps"."user_id" = "notifications"."user_id") AND ("p"."creator_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (( SELECT "auth"."uid"() AS "uid") IS NULL)));



CREATE POLICY "Manage deletes" ON "public"."organization_members" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_members"."organization_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = 'admin'::"text")))) OR ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_members"."organization_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = 'staff'::"text")))) AND (("role")::"text" <> 'admin'::"text")) OR ("user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Manage member inserts" ON "public"."organization_members" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_members"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role")::"text" = 'admin'::"text")))) OR ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_members"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role")::"text" = 'staff'::"text")))) AND (("role")::"text" <> 'admin'::"text")) OR (("user_id" = "auth"."uid"()) AND (("role")::"text" = 'member'::"text")) OR (("user_id" = "auth"."uid"()) AND (("role")::"text" = 'admin'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."organizations" "o"
  WHERE (("o"."id" = "organization_members"."organization_id") AND ("o"."created_by" = "auth"."uid"())))))));



CREATE POLICY "Manage member updates" ON "public"."organization_members" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_members"."organization_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = 'admin'::"text")))) OR ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_members"."organization_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = 'staff'::"text")))) AND (("role")::"text" <> 'admin'::"text")))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_members"."organization_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = 'admin'::"text")))) OR ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_members"."organization_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = 'staff'::"text")))) AND (("role")::"text" <> 'admin'::"text"))));



CREATE POLICY "Org admins can delete calendar sync" ON "public"."organization_calendar_syncs" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "organization_calendar_syncs"."organization_id") AND (("om"."role")::"text" = 'admin'::"text")))));



CREATE POLICY "Org admins can insert calendar sync" ON "public"."organization_calendar_syncs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "organization_calendar_syncs"."organization_id") AND (("om"."role")::"text" = 'admin'::"text")))));



CREATE POLICY "Org admins/staff can create calendar events" ON "public"."organization_calendar_events" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "organization_calendar_events"."organization_id") AND (("om"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'staff'::character varying])::"text"[]))))));



CREATE POLICY "Org admins/staff can delete calendar events" ON "public"."organization_calendar_events" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "organization_calendar_events"."organization_id") AND (("om"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'staff'::character varying])::"text"[]))))));



CREATE POLICY "Org admins/staff can update calendar events" ON "public"."organization_calendar_events" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "organization_calendar_events"."organization_id") AND (("om"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'staff'::character varying])::"text"[])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "organization_calendar_events"."organization_id") AND (("om"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'staff'::character varying])::"text"[]))))));



CREATE POLICY "Org admins/staff can update calendar sync" ON "public"."organization_calendar_syncs" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "organization_calendar_syncs"."organization_id") AND (("om"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'staff'::character varying])::"text"[])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "organization_calendar_syncs"."organization_id") AND (("om"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'staff'::character varying])::"text"[]))))));



CREATE POLICY "Org members can read calendar events" ON "public"."organization_calendar_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "organization_calendar_events"."organization_id")))));



CREATE POLICY "Org members can read calendar sync" ON "public"."organization_calendar_syncs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "organization_calendar_syncs"."organization_id")))));



CREATE POLICY "Public read active system banners" ON "public"."system_banners" FOR SELECT USING ((("is_active" = true) AND (("starts_at" IS NULL) OR ("starts_at" <= "now"())) AND (("ends_at" IS NULL) OR ("ends_at" >= "now"()))));



CREATE POLICY "Users can create own drafts" ON "public"."project_drafts" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can delete own drafts" ON "public"."project_drafts" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can delete their own calendar connections" ON "public"."user_calendar_connections" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can delete their own emails" ON "public"."user_emails" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert own export jobs" ON "public"."account_data_export_jobs" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND ("auth"."uid"() = "requested_by")));



CREATE POLICY "Users can insert their own calendar connections" ON "public"."user_calendar_connections" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert their own emails" ON "public"."user_emails" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own drafts" ON "public"."project_drafts" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update their own calendar connections" ON "public"."user_calendar_connections" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update their own emails" ON "public"."user_emails" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update their own notifications" ON "public"."notifications" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own drafts" ON "public"."project_drafts" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own export audit logs" ON "public"."account_data_export_audit_logs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own export jobs" ON "public"."account_data_export_jobs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own calendar connections" ON "public"."user_calendar_connections" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view their own emails" ON "public"."user_emails" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view their own notifications" ON "public"."notifications" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."account_data_export_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."account_data_export_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."anonymous_signups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anonymous_signups_delete_authenticated" ON "public"."anonymous_signups" FOR DELETE TO "authenticated" USING ((("linked_user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_project_organizer"("project_id", "auth"."uid"())));



CREATE POLICY "anonymous_signups_insert_authenticated" ON "public"."anonymous_signups" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_super_admin"() OR "public"."is_project_organizer"("project_id", "auth"."uid"())));



CREATE POLICY "anonymous_signups_select_authenticated" ON "public"."anonymous_signups" FOR SELECT TO "authenticated" USING ((("linked_user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_project_organizer"("project_id", "auth"."uid"())));



CREATE POLICY "anonymous_signups_update_authenticated" ON "public"."anonymous_signups" FOR UPDATE TO "authenticated" USING ((("linked_user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_project_organizer"("project_id", "auth"."uid"()))) WITH CHECK ((("linked_user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_project_organizer"("project_id", "auth"."uid"())));



ALTER TABLE "public"."banned_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."certificates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "certificates_delete_authenticated" ON "public"."certificates" FOR DELETE TO "authenticated" USING ((( SELECT "public"."is_super_admin"() AS "is_super_admin") OR (EXISTS ( SELECT 1
   FROM ("public"."projects" "p"
     JOIN "public"."project_signups" "s" ON (("s"."project_id" = "p"."id")))
  WHERE (("s"."id" = "certificates"."signup_id") AND ("p"."creator_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ((("type" = 'verified'::"text") AND (( SELECT "auth"."uid"() AS "uid") = "creator_id")) OR (("type" = 'self-reported'::"text") AND (( SELECT "auth"."uid"() AS "uid") = "user_id")))));



CREATE POLICY "certificates_insert_authenticated" ON "public"."certificates" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."is_super_admin"() AS "is_super_admin") OR (EXISTS ( SELECT 1
   FROM ("public"."projects" "p"
     JOIN "public"."project_signups" "s" ON (("s"."project_id" = "p"."id")))
  WHERE (("s"."id" = "certificates"."signup_id") AND ("p"."creator_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ((("type" = 'verified'::"text") AND (( SELECT "auth"."uid"() AS "uid") = "creator_id")) OR (("type" = 'self-reported'::"text") AND (( SELECT "auth"."uid"() AS "uid") = "user_id")))));



CREATE POLICY "certificates_select_authenticated_owner_or_organizer" ON "public"."certificates" FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR ("user_id" = "auth"."uid"()) OR ("creator_id" = "auth"."uid"()) OR ("lower"(COALESCE("volunteer_email", ''::"text")) = "lower"(COALESCE((( SELECT "p"."email"
   FROM "public"."profiles" "p"
  WHERE ("p"."id" = "auth"."uid"())))::"text", ''::"text"))) OR "public"."is_project_organizer"("project_id", "auth"."uid"())));



CREATE POLICY "certificates_update_authenticated" ON "public"."certificates" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."is_super_admin"() AS "is_super_admin") OR (EXISTS ( SELECT 1
   FROM ("public"."projects" "p"
     JOIN "public"."project_signups" "s" ON (("s"."project_id" = "p"."id")))
  WHERE (("s"."id" = "certificates"."signup_id") AND ("p"."creator_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ((("type" = 'verified'::"text") AND (( SELECT "auth"."uid"() AS "uid") = "creator_id")) OR (("type" = 'self-reported'::"text") AND (( SELECT "auth"."uid"() AS "uid") = "user_id"))))) WITH CHECK ((( SELECT "public"."is_super_admin"() AS "is_super_admin") OR (EXISTS ( SELECT 1
   FROM ("public"."projects" "p"
     JOIN "public"."project_signups" "s" ON (("s"."project_id" = "p"."id")))
  WHERE (("s"."id" = "certificates"."signup_id") AND ("p"."creator_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ((("type" = 'verified'::"text") AND (( SELECT "auth"."uid"() AS "uid") = "creator_id")) OR (("type" = 'self-reported'::"text") AND (( SELECT "auth"."uid"() AS "uid") = "user_id")))));



ALTER TABLE "public"."content_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_flags_insert_authenticated" ON "public"."content_flags" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));



ALTER TABLE "public"."content_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_reports_delete_merged" ON "public"."content_reports" FOR DELETE TO "authenticated" USING ((((( SELECT "auth"."jwt"() AS "jwt") ->> 'is_super_admin'::"text") = 'true'::"text") OR (( SELECT "auth"."uid"() AS "uid") = "reporter_id")));



CREATE POLICY "content_reports_insert_merged" ON "public"."content_reports" FOR INSERT TO "authenticated" WITH CHECK ((((( SELECT "auth"."jwt"() AS "jwt") ->> 'is_super_admin'::"text") = 'true'::"text") OR (( SELECT "auth"."uid"() AS "uid") = "reporter_id") OR ("reporter_id" IS NULL)));



CREATE POLICY "content_reports_select_merged" ON "public"."content_reports" FOR SELECT TO "authenticated" USING ((((( SELECT "auth"."jwt"() AS "jwt") ->> 'is_super_admin'::"text") = 'true'::"text") OR (( SELECT "auth"."uid"() AS "uid") = "reporter_id")));



CREATE POLICY "content_reports_update_merged" ON "public"."content_reports" FOR UPDATE TO "authenticated" USING ((((( SELECT "auth"."jwt"() AS "jwt") ->> 'is_super_admin'::"text") = 'true'::"text") OR (( SELECT "auth"."uid"() AS "uid") = "reporter_id"))) WITH CHECK ((((( SELECT "auth"."jwt"() AS "jwt") ->> 'is_super_admin'::"text") = 'true'::"text") OR (( SELECT "auth"."uid"() AS "uid") = "reporter_id")));



ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_delete_authenticated" ON "public"."feedback" FOR DELETE TO "authenticated" USING (((((( SELECT "auth"."jwt"() AS "jwt") -> 'app_metadata'::"text") ->> 'is_super_admin'::"text") = 'true'::"text") OR ((((( SELECT "auth"."jwt"() AS "jwt") -> 'app_metadata'::"text") ->> 'is_super_admin'::"text"))::boolean IS TRUE) OR (( SELECT "auth"."uid"() AS "uid") = "user_id")));



CREATE POLICY "feedback_insert_authenticated" ON "public"."feedback" FOR INSERT TO "authenticated" WITH CHECK (((((( SELECT "auth"."jwt"() AS "jwt") -> 'app_metadata'::"text") ->> 'is_super_admin'::"text") = 'true'::"text") OR ((((( SELECT "auth"."jwt"() AS "jwt") -> 'app_metadata'::"text") ->> 'is_super_admin'::"text"))::boolean IS TRUE) OR (( SELECT "auth"."uid"() AS "uid") = "user_id")));



CREATE POLICY "feedback_select_authenticated" ON "public"."feedback" FOR SELECT TO "authenticated" USING (((((( SELECT "auth"."jwt"() AS "jwt") -> 'app_metadata'::"text") ->> 'is_super_admin'::"text") = 'true'::"text") OR ((((( SELECT "auth"."jwt"() AS "jwt") -> 'app_metadata'::"text") ->> 'is_super_admin'::"text"))::boolean IS TRUE) OR (( SELECT "auth"."uid"() AS "uid") = "user_id")));



CREATE POLICY "feedback_update_authenticated" ON "public"."feedback" FOR UPDATE TO "authenticated" USING (((((( SELECT "auth"."jwt"() AS "jwt") -> 'app_metadata'::"text") ->> 'is_super_admin'::"text") = 'true'::"text") OR ((((( SELECT "auth"."jwt"() AS "jwt") -> 'app_metadata'::"text") ->> 'is_super_admin'::"text"))::boolean IS TRUE) OR (( SELECT "auth"."uid"() AS "uid") = "user_id"))) WITH CHECK (((((( SELECT "auth"."jwt"() AS "jwt") -> 'app_metadata'::"text") ->> 'is_super_admin'::"text") = 'true'::"text") OR ((((( SELECT "auth"."jwt"() AS "jwt") -> 'app_metadata'::"text") ->> 'is_super_admin'::"text"))::boolean IS TRUE) OR (( SELECT "auth"."uid"() AS "uid") = "user_id")));



ALTER TABLE "public"."notification_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_settings_insert_own_or_admin" ON "public"."notification_settings" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"()));



CREATE POLICY "notification_settings_select_own_or_admin" ON "public"."notification_settings" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"()));



CREATE POLICY "notification_settings_update_own_or_admin" ON "public"."notification_settings" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"())) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"()));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_sheet_syncs_delete_admins" ON "public"."organization_sheet_syncs" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_sheet_syncs"."organization_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = 'admin'::"text")))));



CREATE POLICY "org_sheet_syncs_insert_admins" ON "public"."organization_sheet_syncs" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_sheet_syncs"."organization_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = 'admin'::"text")))));



CREATE POLICY "org_sheet_syncs_select_members" ON "public"."organization_sheet_syncs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_sheet_syncs"."organization_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = ANY (ARRAY['admin'::"text", 'staff'::"text"]))))));



CREATE POLICY "org_sheet_syncs_update_admins" ON "public"."organization_sheet_syncs" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_sheet_syncs"."organization_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_sheet_syncs"."organization_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("om"."role")::"text" = 'admin'::"text")))));



ALTER TABLE "public"."organization_calendar_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_calendar_syncs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_sheet_syncs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_authenticated_merged" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "profiles_select_authenticated_self_super_admin_or_org_staff" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "id") OR "public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM ("public"."organization_members" "viewer"
     JOIN "public"."organization_members" "target" ON (("target"."organization_id" = "viewer"."organization_id")))
  WHERE (("viewer"."user_id" = "auth"."uid"()) AND (("viewer"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'staff'::character varying])::"text"[])) AND ("target"."user_id" = "profiles"."id"))))));



CREATE POLICY "profiles_update_authenticated_self_or_super_admin" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "id") OR "public"."is_super_admin"())) WITH CHECK ((("auth"."uid"() = "id") OR "public"."is_super_admin"()));



ALTER TABLE "public"."project_cancellation_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_drafts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_signups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_signups_delete_authenticated" ON "public"."project_signups" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_project_organizer"("project_id", "auth"."uid"())));



CREATE POLICY "project_signups_insert_authenticated" ON "public"."project_signups" FOR INSERT TO "authenticated" WITH CHECK (((("auth"."uid"() IS NOT NULL) AND ("user_id" = "auth"."uid"())) OR "public"."is_super_admin"() OR "public"."is_project_organizer"("project_id", "auth"."uid"())));



CREATE POLICY "project_signups_select_authenticated" ON "public"."project_signups" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_project_organizer"("project_id", "auth"."uid"())));



CREATE POLICY "project_signups_update_authenticated" ON "public"."project_signups" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_project_organizer"("project_id", "auth"."uid"()))) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_super_admin"() OR "public"."is_project_organizer"("project_id", "auth"."uid"())));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects insert consolidated" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("creator_id" = "auth"."uid"()) AND "public"."can_insert_project"("auth"."uid"(), "visibility", "organization_id")));



CREATE POLICY "projects_select_anon" ON "public"."projects" FOR SELECT TO "anon" USING ((("visibility" = ANY (ARRAY['public'::"text", 'unlisted'::"text"])) AND (("workflow_status" IS NULL) OR ("workflow_status" = 'published'::"text"))));



CREATE POLICY "projects_select_authenticated" ON "public"."projects" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "creator_id") OR (("visibility" = ANY (ARRAY['public'::"text", 'unlisted'::"text"])) AND (("workflow_status" IS NULL) OR ("workflow_status" = 'published'::"text"))) OR (EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "projects"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'staff'::character varying])::"text"[])))))));



ALTER TABLE "public"."system_banners" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trusted_member" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trusted_member_delete_authenticated" ON "public"."trusted_member" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_super_admin"() AS "is_super_admin"));



CREATE POLICY "trusted_member_insert_authenticated" ON "public"."trusted_member" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."is_super_admin"() AS "is_super_admin") OR (( SELECT "auth"."uid"() AS "uid") = "user_id")));



CREATE POLICY "trusted_member_select_authenticated" ON "public"."trusted_member" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_super_admin"() AS "is_super_admin") OR (( SELECT "auth"."uid"() AS "uid") = "user_id")));



CREATE POLICY "trusted_member_update_authenticated" ON "public"."trusted_member" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."is_super_admin"() AS "is_super_admin") OR ((( SELECT "auth"."uid"() AS "uid") = "user_id") AND ("status" IS NULL)))) WITH CHECK ((( SELECT "public"."is_super_admin"() AS "is_super_admin") OR ((( SELECT "auth"."uid"() AS "uid") = "user_id") AND ("status" IS NULL))));



ALTER TABLE "public"."user_calendar_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."waiver_definition_fields" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "waiver_definition_fields_read_policy" ON "public"."waiver_definition_fields" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."waiver_definitions"
  WHERE (("waiver_definitions"."id" = "waiver_definition_fields"."waiver_definition_id") AND (("waiver_definitions"."scope" = 'global'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."projects"
          WHERE ("projects"."id" = "waiver_definitions"."project_id"))))))));



CREATE POLICY "waiver_definition_fields_write_policy" ON "public"."waiver_definition_fields" USING ((EXISTS ( SELECT 1
   FROM "public"."waiver_definitions"
  WHERE (("waiver_definitions"."id" = "waiver_definition_fields"."waiver_definition_id") AND ("waiver_definitions"."scope" = 'project'::"text") AND (EXISTS ( SELECT 1
           FROM "public"."projects"
          WHERE (("projects"."id" = "waiver_definitions"."project_id") AND ("projects"."creator_id" = "auth"."uid"()))))))));



ALTER TABLE "public"."waiver_definition_signers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "waiver_definition_signers_read_policy" ON "public"."waiver_definition_signers" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."waiver_definitions"
  WHERE (("waiver_definitions"."id" = "waiver_definition_signers"."waiver_definition_id") AND (("waiver_definitions"."scope" = 'global'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."projects"
          WHERE ("projects"."id" = "waiver_definitions"."project_id"))))))));



CREATE POLICY "waiver_definition_signers_write_policy" ON "public"."waiver_definition_signers" USING ((EXISTS ( SELECT 1
   FROM "public"."waiver_definitions"
  WHERE (("waiver_definitions"."id" = "waiver_definition_signers"."waiver_definition_id") AND ("waiver_definitions"."scope" = 'project'::"text") AND (EXISTS ( SELECT 1
           FROM "public"."projects"
          WHERE (("projects"."id" = "waiver_definitions"."project_id") AND ("projects"."creator_id" = "auth"."uid"()))))))));



ALTER TABLE "public"."waiver_definitions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "waiver_definitions_read_policy" ON "public"."waiver_definitions" FOR SELECT USING ((("scope" = 'global'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE ("projects"."id" = "waiver_definitions"."project_id")))));



CREATE POLICY "waiver_definitions_write_policy" ON "public"."waiver_definitions" USING ((("scope" = 'project'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "waiver_definitions"."project_id") AND ("projects"."creator_id" = "auth"."uid"()))))));



ALTER TABLE "public"."waiver_signatures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "waiver_signatures_insert_policy" ON "public"."waiver_signatures" FOR INSERT WITH CHECK (((("auth"."uid"() IS NOT NULL) AND (("user_id" IS NULL) OR ("user_id" = "auth"."uid"()))) OR (("auth"."uid"() IS NULL) AND ("user_id" IS NULL))));



COMMENT ON POLICY "waiver_signatures_insert_policy" ON "public"."waiver_signatures" IS 'Allows authenticated and anonymous users to submit signatures.';



CREATE POLICY "waiver_signatures_read_policy" ON "public"."waiver_signatures" FOR SELECT USING (((("auth"."uid"() IS NOT NULL) AND ("auth"."uid"() = "user_id")) OR (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "waiver_signatures"."project_id") AND (("p"."creator_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."organization_members" "om"
          WHERE (("om"."organization_id" = "p"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'staff'::character varying])::"text"[]))))))))) OR (EXISTS ( SELECT 1
   FROM "public"."waiver_definitions"
  WHERE (("waiver_definitions"."id" = "waiver_signatures"."waiver_definition_id") AND ("waiver_definitions"."created_by" = "auth"."uid"()))))));



CREATE POLICY "waiver_signatures_update_policy" ON "public"."waiver_signatures" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "waiver_signatures"."project_id") AND (("p"."creator_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."organization_members" "om"
          WHERE (("om"."organization_id" = "p"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'staff'::character varying])::"text"[])))))))))));



ALTER TABLE "public"."waiver_templates" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."before_insert_org_member"() TO "anon";
GRANT ALL ON FUNCTION "public"."before_insert_org_member"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."before_insert_org_member"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_insert_project"("p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_insert_project"("p_user" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."can_insert_project"("p_user" "uuid") TO "supabase_admin";
GRANT ALL ON FUNCTION "public"."can_insert_project"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_insert_project"("p_user" "uuid") TO "anon";



GRANT ALL ON FUNCTION "public"."can_insert_project"("p_user" "uuid", "p_visibility" "text", "p_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_insert_project"("p_user" "uuid", "p_visibility" "text", "p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_insert_project"("p_user" "uuid", "p_visibility" "text", "p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_keep_or_set_public_visibility"("p_project_id" "uuid", "p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_keep_or_set_public_visibility"("p_project_id" "uuid", "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_keep_or_set_public_visibility"("p_project_id" "uuid", "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_email_exists"("email_to_check" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_email_exists"("email_to_check" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_email_exists"("email_to_check" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_username_unique"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_username_unique"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_username_unique"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_username_unique"("username" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_username_unique"("username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_username_unique"("username" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."checkin_signups"() TO "anon";
GRANT ALL ON FUNCTION "public"."checkin_signups"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."checkin_signups"() TO "service_role";



GRANT ALL ON FUNCTION "public"."checkout_signups"() TO "anon";
GRANT ALL ON FUNCTION "public"."checkout_signups"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."checkout_signups"() TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_trusted_member_on_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."clear_trusted_member_on_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_trusted_member_on_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_old_anonymous_signups"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_old_anonymous_signups"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_old_anonymous_signups"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_unconfirmed_users"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_unconfirmed_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_unconfirmed_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_profile_exists"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_profile_exists"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_profile_exists"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_profile_exists"("p_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."ensure_profile_exists"("p_user_id" "uuid") TO "supabase_admin";



GRANT ALL ON FUNCTION "public"."gen_unique_username"("base" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."gen_unique_username"("base" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gen_unique_username"("base" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_auth_avatar_url"("auth_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_auth_avatar_url"("auth_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_auth_avatar_url"("auth_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_organization_members"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_organization_members"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_organization_members"("org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_attendees"("p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_attendees"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_attendees"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_attendees"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_auto_join_on_signup"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_auto_join_on_signup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_auto_join_on_signup"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_organizer"("p_project_id" "uuid", "p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_project_organizer"("p_project_id" "uuid", "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_organizer"("p_project_id" "uuid", "p_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_trusted_member"("p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_trusted_member"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_trusted_member"("p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_trusted_member_edit"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_trusted_member_edit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_trusted_member_edit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_projects"() TO "anon";
GRANT ALL ON FUNCTION "public"."process_projects"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_projects"() TO "service_role";



GRANT ALL ON FUNCTION "public"."profiles_block_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."profiles_block_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."profiles_block_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."profiles_set_defaults"() TO "anon";
GRANT ALL ON FUNCTION "public"."profiles_set_defaults"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."profiles_set_defaults"() TO "service_role";



GRANT ALL ON FUNCTION "public"."profiles_set_username"() TO "anon";
GRANT ALL ON FUNCTION "public"."profiles_set_username"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."profiles_set_username"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_system_banners_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_system_banners_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_system_banners_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_profiles_trusted_from_tm"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_profiles_trusted_from_tm"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_profiles_trusted_from_tm"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_profiles_trusted_from_tm"() TO "service_role";
GRANT ALL ON FUNCTION "public"."sync_profiles_trusted_from_tm"() TO "supabase_admin";



GRANT ALL ON FUNCTION "public"."sync_tm_from_profiles_trusted"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_tm_from_profiles_trusted"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_tm_from_profiles_trusted"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_trusted_member_to_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_trusted_member_to_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_trusted_member_to_profile"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_user_email_to_custom_table"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_user_email_to_custom_table"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_user_email_to_custom_table"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trusted_member_set_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."trusted_member_set_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trusted_member_set_user_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profile_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_profile_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profile_email"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profile_email"("p_user_id" "uuid", "p_new_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_profile_email"("p_user_id" "uuid", "p_new_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profile_email"("p_user_id" "uuid", "p_new_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_project_draft_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_project_draft_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_project_draft_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_project_draft_updated_at"("project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_project_draft_updated_at"("project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_project_draft_updated_at"("project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_profile_picture"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_profile_picture"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_profile_picture"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_profile_picture"("user_id" bigint, "picture_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_profile_picture"("user_id" bigint, "picture_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_profile_picture"("user_id" bigint, "picture_url" "text") TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."account_data_export_audit_logs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."account_data_export_audit_logs" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."account_data_export_audit_logs" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."account_data_export_jobs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."account_data_export_jobs" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."account_data_export_jobs" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."anonymous_signups" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."anonymous_signups" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."anonymous_signups" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."banned_emails" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."banned_emails" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."banned_emails" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."certificates" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."certificates" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."certificates" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."content_flags" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."content_flags" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."content_flags" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."content_reports" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."content_reports" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."feedback" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."feedback" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."feedback" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."notification_settings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."notification_settings" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."notification_settings" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."notifications" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."notifications" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_calendar_events" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_calendar_events" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_calendar_events" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_calendar_syncs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_calendar_syncs" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_calendar_syncs" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_members" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_members" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_members" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_sheet_syncs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_sheet_syncs" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organization_sheet_syncs" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organizations" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organizations" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."organizations" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."profiles" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."project_cancellation_jobs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."project_cancellation_jobs" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."project_cancellation_jobs" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."project_drafts" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."project_drafts" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."project_drafts" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."project_signups" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."project_signups" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."project_signups" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."projects" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."projects" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."projects" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."projects_with_creator" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."projects_with_creator" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."projects_with_creator" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."system_banners" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."system_banners" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."system_banners" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."trusted_member" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."trusted_member" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."user_calendar_connections" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."user_calendar_connections" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."user_calendar_connections" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."user_emails" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."user_emails" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."user_emails" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_definition_fields" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_definition_fields" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_definition_fields" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_definition_signers" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_definition_signers" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_definition_signers" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_definitions" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_definitions" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_definitions" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_signatures" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_signatures" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_signatures" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_templates" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_templates" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."waiver_templates" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO "service_role";







