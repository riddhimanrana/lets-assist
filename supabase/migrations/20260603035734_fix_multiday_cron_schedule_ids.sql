-- The previous multi-day schedule-id migration updated process_automatic_*,
-- but pg_cron still calls checkin_signups() and checkout_signups().
-- Keep these cron entrypoints compatible with unique multi-day IDs and skip
-- blank schedule times instead of casting '' to timestamp.

CREATE OR REPLACE FUNCTION public.checkin_signups()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
    signup RECORD;
    calculated_start_time timestamptz;
    current_time_utc timestamptz := now();
    target_date_str text;
    day_index int;
    slot_index int;
    day_element jsonb;
    slot_element jsonb;
    role_element jsonb;
    time_str text;
    project_tz text;
BEGIN
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
        calculated_start_time := NULL;
        target_date_str := NULL;
        day_element := NULL;
        slot_element := NULL;
        role_element := NULL;
        time_str := NULL;
        project_tz := COALESCE(NULLIF(signup.project_timezone, ''), 'America/Los_Angeles');

        BEGIN
            IF signup.event_type = 'oneTime' AND signup.schedule ? 'oneTime' AND signup.schedule_id = 'oneTime' THEN
                target_date_str := NULLIF(signup.schedule->'oneTime'->>'date', '');
                time_str := NULLIF(signup.schedule->'oneTime'->>'startTime', '');

            ELSIF signup.event_type = 'multiDay' AND signup.schedule ? 'multiDay' THEN
                IF signup.schedule_id ~ '^\d{4}-\d{2}-\d{2}-\d+-\d+$' THEN
                    target_date_str := substring(signup.schedule_id from '^\d{4}-\d{2}-\d{2}');
                    day_index := split_part(signup.schedule_id, '-', 4)::int;
                    slot_index := split_part(signup.schedule_id, '-', 5)::int;
                    day_element := signup.schedule->'multiDay'->day_index;
                ELSIF signup.schedule_id ~ '^\d{4}-\d{2}-\d{2}-\d+$' THEN
                    target_date_str := substring(signup.schedule_id from '^\d{4}-\d{2}-\d{2}');
                    slot_index := substring(signup.schedule_id from '-(\d+)$')::int;

                    SELECT elem
                    INTO day_element
                    FROM jsonb_array_elements(signup.schedule->'multiDay') elem
                    WHERE elem->>'date' = target_date_str
                    LIMIT 1;
                END IF;

                IF day_element IS NOT NULL
                   AND day_element ? 'slots'
                   AND jsonb_typeof(day_element->'slots') = 'array'
                   AND slot_index >= 0
                   AND slot_index < jsonb_array_length(day_element->'slots') THEN
                    slot_element := day_element->'slots'->slot_index;
                    time_str := NULLIF(slot_element->>'startTime', '');
                END IF;

            ELSIF signup.event_type = 'sameDayMultiArea' AND signup.schedule ? 'sameDayMultiArea' THEN
                target_date_str := NULLIF(signup.schedule->'sameDayMultiArea'->>'date', '');

                IF signup.schedule->'sameDayMultiArea' ? 'roles'
                   AND jsonb_typeof(signup.schedule->'sameDayMultiArea'->'roles') = 'array' THEN
                    SELECT elem
                    INTO role_element
                    FROM jsonb_array_elements(signup.schedule->'sameDayMultiArea'->'roles') elem
                    WHERE elem->>'name' = signup.schedule_id
                    LIMIT 1;

                    time_str := NULLIF(role_element->>'startTime', '');
                END IF;
            END IF;

            IF target_date_str IS NOT NULL AND time_str IS NOT NULL THEN
                calculated_start_time := (target_date_str || ' ' || time_str)::timestamp without time zone AT TIME ZONE project_tz;
            END IF;

            IF calculated_start_time IS NOT NULL AND current_time_utc >= calculated_start_time THEN
                UPDATE public.project_signups
                SET check_in_time = calculated_start_time,
                    status = 'attended'
                WHERE id = signup.id
                  AND status = 'approved';
            END IF;
        EXCEPTION WHEN others THEN
            RAISE WARNING 'Error processing check-in for signup ID % (schedule_id %): %', signup.id, signup.schedule_id, SQLERRM;
            CONTINUE;
        END;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.checkout_signups()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
    signup RECORD;
    calculated_end_time timestamptz;
    current_time_utc timestamptz := now();
    target_date_str text;
    day_index int;
    slot_index int;
    day_element jsonb;
    slot_element jsonb;
    role_element jsonb;
    time_str text;
    project_tz text;
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
        calculated_end_time := NULL;
        target_date_str := NULL;
        day_element := NULL;
        slot_element := NULL;
        role_element := NULL;
        time_str := NULL;
        project_tz := COALESCE(NULLIF(signup.project_timezone, ''), 'America/Los_Angeles');

        BEGIN
            IF signup.event_type = 'oneTime' AND signup.schedule ? 'oneTime' AND signup.schedule_id = 'oneTime' THEN
                target_date_str := NULLIF(signup.schedule->'oneTime'->>'date', '');
                time_str := NULLIF(signup.schedule->'oneTime'->>'endTime', '');

            ELSIF signup.event_type = 'multiDay' AND signup.schedule ? 'multiDay' THEN
                IF signup.schedule_id ~ '^\d{4}-\d{2}-\d{2}-\d+-\d+$' THEN
                    target_date_str := substring(signup.schedule_id from '^\d{4}-\d{2}-\d{2}');
                    day_index := split_part(signup.schedule_id, '-', 4)::int;
                    slot_index := split_part(signup.schedule_id, '-', 5)::int;
                    day_element := signup.schedule->'multiDay'->day_index;
                ELSIF signup.schedule_id ~ '^\d{4}-\d{2}-\d{2}-\d+$' THEN
                    target_date_str := substring(signup.schedule_id from '^\d{4}-\d{2}-\d{2}');
                    slot_index := substring(signup.schedule_id from '-(\d+)$')::int;

                    SELECT elem
                    INTO day_element
                    FROM jsonb_array_elements(signup.schedule->'multiDay') elem
                    WHERE elem->>'date' = target_date_str
                    LIMIT 1;
                END IF;

                IF day_element IS NOT NULL
                   AND day_element ? 'slots'
                   AND jsonb_typeof(day_element->'slots') = 'array'
                   AND slot_index >= 0
                   AND slot_index < jsonb_array_length(day_element->'slots') THEN
                    slot_element := day_element->'slots'->slot_index;
                    time_str := NULLIF(slot_element->>'endTime', '');
                END IF;

            ELSIF signup.event_type = 'sameDayMultiArea' AND signup.schedule ? 'sameDayMultiArea' THEN
                target_date_str := NULLIF(signup.schedule->'sameDayMultiArea'->>'date', '');

                IF signup.schedule->'sameDayMultiArea' ? 'roles'
                   AND jsonb_typeof(signup.schedule->'sameDayMultiArea'->'roles') = 'array' THEN
                    SELECT elem
                    INTO role_element
                    FROM jsonb_array_elements(signup.schedule->'sameDayMultiArea'->'roles') elem
                    WHERE elem->>'name' = signup.schedule_id
                    LIMIT 1;

                    time_str := NULLIF(role_element->>'endTime', '');
                END IF;
            END IF;

            IF target_date_str IS NOT NULL AND time_str IS NOT NULL THEN
                calculated_end_time := (target_date_str || ' ' || time_str)::timestamp without time zone AT TIME ZONE project_tz;
            END IF;

            IF calculated_end_time IS NOT NULL AND current_time_utc >= calculated_end_time THEN
                UPDATE public.project_signups
                SET check_out_time = calculated_end_time
                WHERE id = signup.id
                  AND check_out_time IS NULL;
            END IF;
        EXCEPTION WHEN others THEN
            RAISE WARNING 'Error processing check-out for signup ID % (schedule_id %): %', signup.id, signup.schedule_id, SQLERRM;
            CONTINUE;
        END;
    END LOOP;
END;
$$;
