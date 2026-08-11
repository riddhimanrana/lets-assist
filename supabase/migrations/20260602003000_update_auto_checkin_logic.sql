-- Migration to update auto-check-in and auto-checkout logic to support unique multi-day IDs
-- This ensures background automation handles the new 5-part ID format.

CREATE OR REPLACE FUNCTION public.process_automatic_check_ins()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    signup RECORD;
    calculated_start_time_timestamptz TIMESTAMPTZ;
    current_time_utc TIMESTAMPTZ := now();
    target_date_str TEXT;
    day_index INT;
    slot_index INT;
    day_element JSONB;
    slot_element JSONB;
    time_str TEXT;
    project_tz TEXT;
BEGIN
    FOR signup IN 
        SELECT ps.id, ps.schedule_id, p.schedule, p.event_type, p.project_timezone
        FROM public.project_signups ps
        JOIN public.projects p ON p.id = ps.project_id
        WHERE ps.status = 'approved'
          AND ps.check_in_time IS NULL
          AND p.status = 'upcoming'
          AND p.verification_method = 'auto'
    LOOP
        project_tz := COALESCE(signup.project_timezone, 'UTC');
        calculated_start_time_timestamptz := NULL;

        IF signup.event_type = 'oneTime' AND signup.schedule_id = 'oneTime' THEN
            time_str := signup.schedule->'oneTime'->>'startTime';
            target_date_str := signup.schedule->'oneTime'->>'date';
            IF target_date_str IS NOT NULL AND time_str IS NOT NULL THEN
                calculated_start_time_timestamptz := (target_date_str || ' ' || time_str)::timestamp without time zone AT TIME ZONE project_tz AT TIME ZONE 'UTC';
            END IF;
        ELSIF signup.event_type = 'multiDay' THEN
            -- New 5-part format: YYYY-MM-DD-dayIndex-slotIndex
            IF signup.schedule_id ~ '^\d{4}-\d{2}-\d{2}-\d+-\d+$' THEN
                target_date_str := substring(signup.schedule_id from '^\d{4}-\d{2}-\d{2}');
                day_index := split_part(signup.schedule_id, '-', 4)::INT;
                slot_index := split_part(signup.schedule_id, '-', 5)::INT;
                
                day_element := signup.schedule->'multiDay'->day_index;
                IF day_element IS NOT NULL AND day_element ? 'slots' THEN
                    slot_element := day_element->'slots'->slot_index;
                    time_str := slot_element->>'startTime';
                    IF time_str IS NOT NULL THEN
                        calculated_start_time_timestamptz := (target_date_str || ' ' || time_str)::timestamp without time zone AT TIME ZONE project_tz AT TIME ZONE 'UTC';
                    END IF;
                END IF;
            -- Legacy 4-part format: YYYY-MM-DD-slotIndex
            ELSIF signup.schedule_id ~ '^\d{4}-\d{2}-\d{2}-\d+$' THEN
                target_date_str := substring(signup.schedule_id from '^\d{4}-\d{2}-\d{2}');
                slot_index := substring(signup.schedule_id from '-(\d+)$')::INT;
                
                SELECT elem INTO day_element FROM jsonb_array_elements(signup.schedule->'multiDay') elem WHERE elem->>'date' = target_date_str LIMIT 1;
                IF day_element IS NOT NULL AND day_element ? 'slots' THEN
                    slot_element := day_element->'slots'->slot_index;
                    time_str := slot_element->>'startTime';
                    IF time_str IS NOT NULL THEN
                        calculated_start_time_timestamptz := (target_date_str || ' ' || time_str)::timestamp without time zone AT TIME ZONE project_tz AT TIME ZONE 'UTC';
                    END IF;
                END IF;
            END IF;
        END IF;

        IF calculated_start_time_timestamptz IS NOT NULL AND current_time_utc >= calculated_start_time_timestamptz THEN
            UPDATE public.project_signups SET check_in_time = calculated_start_time_timestamptz, status = 'attended' WHERE id = signup.id;
        END IF;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_automatic_check_outs()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    signup RECORD;
    calculated_end_time_timestamptz TIMESTAMPTZ;
    current_time_utc TIMESTAMPTZ := now();
    target_date_str TEXT;
    day_index INT;
    slot_index INT;
    day_element JSONB;
    slot_element JSONB;
    time_str TEXT;
    project_tz TEXT;
BEGIN
    FOR signup IN 
        SELECT ps.id, ps.schedule_id, p.schedule, p.event_type, p.project_timezone
        FROM public.project_signups ps
        JOIN public.projects p ON p.id = ps.project_id
        WHERE ps.status = 'attended'
          AND ps.check_in_time IS NOT NULL
          AND ps.check_out_time IS NULL
          AND p.verification_method = 'auto'
    LOOP
        project_tz := COALESCE(signup.project_timezone, 'UTC');
        calculated_end_time_timestamptz := NULL;

        IF signup.event_type = 'oneTime' AND signup.schedule_id = 'oneTime' THEN
            time_str := signup.schedule->'oneTime'->>'endTime';
            target_date_str := signup.schedule->'oneTime'->>'date';
            IF target_date_str IS NOT NULL AND time_str IS NOT NULL THEN
                calculated_end_time_timestamptz := (target_date_str || ' ' || time_str)::timestamp without time zone AT TIME ZONE project_tz AT TIME ZONE 'UTC';
            END IF;
        ELSIF signup.event_type = 'multiDay' THEN
            -- New 5-part format
            IF signup.schedule_id ~ '^\d{4}-\d{2}-\d{2}-\d+-\d+$' THEN
                target_date_str := substring(signup.schedule_id from '^\d{4}-\d{2}-\d{2}');
                day_index := split_part(signup.schedule_id, '-', 4)::INT;
                slot_index := split_part(signup.schedule_id, '-', 5)::INT;
                
                day_element := signup.schedule->'multiDay'->day_index;
                IF day_element IS NOT NULL AND day_element ? 'slots' THEN
                    slot_element := day_element->'slots'->slot_index;
                    time_str := slot_element->>'endTime';
                    IF time_str IS NOT NULL THEN
                        calculated_end_time_timestamptz := (target_date_str || ' ' || time_str)::timestamp without time zone AT TIME ZONE project_tz AT TIME ZONE 'UTC';
                    END IF;
                END IF;
            -- Legacy 4-part format
            ELSIF signup.schedule_id ~ '^\d{4}-\d{2}-\d{2}-\d+$' THEN
                target_date_str := substring(signup.schedule_id from '^\d{4}-\d{2}-\d{2}');
                slot_index := substring(signup.schedule_id from '-(\d+)$')::INT;
                
                SELECT elem INTO day_element FROM jsonb_array_elements(signup.schedule->'multiDay') elem WHERE elem->>'date' = target_date_str LIMIT 1;
                IF day_element IS NOT NULL AND day_element ? 'slots' THEN
                    slot_element := day_element->'slots'->slot_index;
                    time_str := slot_element->>'endTime';
                    IF time_str IS NOT NULL THEN
                        calculated_end_time_timestamptz := (target_date_str || ' ' || time_str)::timestamp without time zone AT TIME ZONE project_tz AT TIME ZONE 'UTC';
                    END IF;
                END IF;
            END IF;
        END IF;

        IF calculated_end_time_timestamptz IS NOT NULL AND current_time_utc >= calculated_end_time_timestamptz THEN
            UPDATE public.project_signups SET check_out_time = calculated_end_time_timestamptz WHERE id = signup.id;
        END IF;
    END LOOP;
END;
$$;
