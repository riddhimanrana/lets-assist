-- Comprehensive Stress Test for Multi-day Signup Migration
-- This script covers multiple users, complex collisions, and varied signup states.

DO $$
DECLARE
    v_org_id UUID := '77777777-7777-7777-7777-777777777777';
    v_project_id UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    -- Multiple volunteers
    v_vol1 UUID := '94587646-a39f-42c5-922f-73bd4b277626'; -- John Smith
    v_vol2 UUID := '2315038c-b612-4714-823d-d524818ff269'; -- Jane Doe
    v_vol3 UUID := '9ae29f12-dac1-4a9e-ae13-5afd15665bec'; -- Dummy Member
BEGIN
    -- 1. Create a Very Complex Project
    -- Day 0: 2026-06-10 (2 slots)
    -- Day 1: 2026-06-10 (3 slots) -- COLLISION with Day 0
    -- Day 2: 2026-06-11 (1 slot)  -- NO COLLISION
    INSERT INTO public.projects (
        id, creator_id, organization_id, title, location, event_type, 
        schedule, status, visibility, published, description, verification_method
    ) VALUES (
        v_project_id,
        '0167486f-8c12-4fb6-889d-cbe328ccd8ad',
        v_org_id,
        'EXHAUSTIVE STRESS TEST PROJECT',
        'Complex Ranch',
        'multiDay',
        '{
            "multiDay": [
                {
                    "date": "2026-06-10",
                    "slots": [
                        {"name": "D0-S0", "startTime": "08:00", "endTime": "10:00", "volunteers": 5},
                        {"name": "D0-S1", "startTime": "10:00", "endTime": "12:00", "volunteers": 5}
                    ]
                },
                {
                    "date": "2026-06-10",
                    "slots": [
                        {"name": "D1-S0", "startTime": "13:00", "endTime": "15:00", "volunteers": 5},
                        {"name": "D1-S1", "startTime": "15:00", "endTime": "17:00", "volunteers": 5},
                        {"name": "D1-S2", "startTime": "17:00", "endTime": "19:00", "volunteers": 5}
                    ]
                },
                {
                    "date": "2026-06-11",
                    "slots": [
                        {"name": "D2-S0", "startTime": "09:00", "endTime": "17:00", "volunteers": 10}
                    ]
                }
            ]
        }'::jsonb,
        'upcoming',
        'public',
        '{"2026-06-10-0": true, "2026-06-10-1": false, "2026-06-11-0": true}'::jsonb,
        'Stress testing the migration logic.',
        'manual'
    ) ON CONFLICT (id) DO UPDATE SET schedule = EXCLUDED.schedule, published = EXCLUDED.published;

    -- 2. Clean existing signups for this test project
    DELETE FROM public.project_signups WHERE project_id = v_project_id;

    -- 3. Setup Legacy Signups (Colliding and Non-Colliding)
    
    -- Case A: Vol 1 signed up for Slot 0 on colliding date.
    -- Expected: Duplicate signups for (D0, S0) and (D1, S0).
    INSERT INTO public.project_signups (project_id, user_id, schedule_id, status, volunteer_comment)
    VALUES (v_project_id, v_vol1, '2026-06-10-0', 'approved', 'I want to help with Slot 0');

    -- Case B: Vol 2 signed up for Slot 1 on colliding date + already checked in.
    -- Expected: Duplicate signups for (D0, S1) and (D1, S1) with check-in preserved.
    INSERT INTO public.project_signups (project_id, user_id, schedule_id, status, check_in_time)
    VALUES (v_project_id, v_vol2, '2026-06-10-1', 'attended', '2026-06-10T10:05:00Z');

    -- Case C: Vol 3 signed up for Slot 0 on NON-colliding date.
    -- Expected: Simple update to (D2, S0). No duplication.
    INSERT INTO public.project_signups (project_id, user_id, schedule_id, status)
    VALUES (v_project_id, v_vol3, '2026-06-11-0', 'pending');

    -- Case D: Vol 1 also signed up for Slot 2 (which only exists on Day 1).
    -- Expected: Update to (D1, S2). No duplication because there is no Slot 2 on Day 0.
    INSERT INTO public.project_signups (project_id, user_id, schedule_id, status)
    VALUES (v_project_id, v_vol1, '2026-06-10-2', 'approved');

    RAISE NOTICE 'Stress test data setup complete.';
END $$;
