-- Migration to upgrade multi-day schedule IDs to a unique format
-- This resolves collisions when multiple days in a multi-day project share the same date.
-- New format: YYYY-MM-DD-dayIndex-slotIndex
-- Old format: YYYY-MM-DD-slotIndex

DO $$
DECLARE
    r_project RECORD;
    v_day_index INT;
    v_slot_index INT;
    v_day JSONB;
    v_slot JSONB;
    v_old_id TEXT;
    v_new_id TEXT;
    v_published JSONB;
    v_new_published JSONB;
    v_matches TEXT[];
    v_first_new_id TEXT;
    v_i INT;
BEGIN
    -- 1. Update projects and their signups
    FOR r_project IN 
        SELECT id, schedule, COALESCE(published, '{}'::jsonb) as published 
        FROM public.projects 
        WHERE event_type = 'multiDay' 
        AND schedule ? 'multiDay'
    LOOP
        v_new_published := '{}'::jsonb;
        
        -- Identify all unique legacy IDs that exist in this project's schedule
        FOR v_old_id IN (
            SELECT DISTINCT (d->>'date' || '-' || (idx - 1)) as old_id
            FROM jsonb_array_elements(r_project.schedule->'multiDay') d,
                 jsonb_array_elements(d->'slots') WITH ORDINALITY AS s(val, idx)
        )
        LOOP
            v_matches := ARRAY[]::TEXT[];
            
            -- Find all new IDs that map to this old ID
            v_day_index := 0;
            FOR v_day IN SELECT * FROM jsonb_array_elements(r_project.schedule->'multiDay')
            LOOP
                v_slot_index := 0;
                FOR v_slot IN SELECT * FROM jsonb_array_elements(v_day->'slots')
                LOOP
                    IF (v_day->>'date' || '-' || v_slot_index) = v_old_id THEN
                        v_new_id := (v_day->>'date') || '-' || v_day_index || '-' || v_slot_index;
                        v_matches := array_append(v_matches, v_new_id);
                    END IF;
                    v_slot_index := v_slot_index + 1;
                END LOOP;
                v_day_index := v_day_index + 1;
            END LOOP;

            -- If we found matches, migrate the signups
            IF array_length(v_matches, 1) > 0 THEN
                v_first_new_id := v_matches[1];
                
                -- 1. First, update existing signups to the first unique ID
                UPDATE public.project_signups 
                SET schedule_id = v_first_new_id
                WHERE project_id = r_project.id 
                AND schedule_id = v_old_id;
                
                -- 2. Then, for any additional colliding slots, duplicate the signups
                -- This ensures they remain signed up for all slots they were seeing in the UI
                FOR v_i IN 2..array_length(v_matches, 1) LOOP
                    INSERT INTO public.project_signups (
                        project_id, user_id, schedule_id, status, created_at, 
                        anonymous_id, check_in_time, check_out_time, 
                        volunteer_comment, response_data
                    )
                    SELECT 
                        project_id, user_id, v_matches[v_i], status, created_at, 
                        anonymous_id, check_in_time, check_out_time, 
                        volunteer_comment, response_data
                    FROM public.project_signups
                    WHERE project_id = r_project.id
                    AND schedule_id = v_first_new_id;
                END LOOP;
                
                -- 3. Update published state tracking
                IF r_project.published ? v_old_id THEN
                    FOR v_i IN 1..array_length(v_matches, 1) LOOP
                        v_new_published := v_new_published || jsonb_build_object(v_matches[v_i], (r_project.published->v_old_id));
                    END LOOP;
                END IF;
            END IF;
        END LOOP;
        
        -- Preserve any other keys in published (like manual overrides)
        v_new_published := r_project.published || v_new_published;

        -- Update the project's published state
        UPDATE public.projects SET published = v_new_published WHERE id = r_project.id;
    END LOOP;
END $$;
