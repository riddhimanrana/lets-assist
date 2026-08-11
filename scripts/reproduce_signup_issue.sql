-- Reproduction and Verification Script for Multi-day Signup Collisions
-- This script creates a project with colliding schedule IDs and some legacy signups.

-- 1. Create a Test Organization (if it doesn't exist)
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
    '77777777-7777-7777-7777-777777777777', 
    'Test Org', 
    'test-org-repro', 
    'nonprofit', 
    'REPRO1'
)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
    -- Using existing user IDs from the local DB to avoid FK violations
    v_creator_id UUID := '0167486f-8c12-4fb6-889d-cbe328ccd8ad'; 
    v_project_id UUID := 'e0d3eedf-6d43-4652-9151-80d705eda5f4'; 
    v_volunteer_id UUID := '2315038c-b612-4714-823d-d524818ff269'; 
BEGIN
    -- 2. Create the Project with the OLD colliding schedule
    -- Date 2026-06-06 appears twice in the array.
    -- Old IDs for first day, slot 0: 2026-06-06-0
    -- Old IDs for second day, slot 0: 2026-06-06-0 (COLLISION!)
    INSERT INTO public.projects (
        id, creator_id, organization_id, title, location, event_type, 
        schedule, status, visibility, can_be_managed_by_staff, published, description, verification_method
    ) VALUES (
        v_project_id,
        v_creator_id,
        '77777777-7777-7777-7777-777777777777',
        'Building Horse Feeders (REPRODUCTION)',
        'Hagemann Ranch',
        'multiDay',
        '{
            "multiDay": [
                {
                    "date": "2026-06-06",
                    "slots": [
                        {"name": "Morning Slot (Scouts)", "endTime": "14:00", "startTime": "10:00", "volunteers": 10},
                        {"name": "Morning Slot (Adults)", "endTime": "14:00", "startTime": "10:00", "volunteers": 7}
                    ]
                },
                {
                    "date": "2026-06-06",
                    "slots": [
                        {"name": "Evening Slot (Scouts)", "endTime": "18:00", "startTime": "14:00", "volunteers": 10},
                        {"name": "Evening Slot (Adults)", "endTime": "18:00", "startTime": "14:00", "volunteers": 3}
                    ]
                }
            ]
        }'::jsonb,
        'upcoming',
        'public',
        true,
        '{"2026-06-06-0": false, "2026-06-06-1": false}'::jsonb, -- Old format tracking
        '<p>Reproduction of the horse feeder project.</p>',
        'manual'
    ) ON CONFLICT (id) DO UPDATE SET schedule = EXCLUDED.schedule, published = EXCLUDED.published;

    -- 3. Insert a legacy signup with a colliding ID
    -- This user signed up for "Morning Slot (Scouts)" in the old system.
    -- But because of the collision, they currently appear in "Evening Slot (Scouts)" too.
    INSERT INTO public.project_signups (
        project_id, user_id, schedule_id, status
    ) VALUES (
        v_project_id,
        v_volunteer_id,
        '2026-06-06-0', -- Legacy ID
        'approved'
    ) ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Reproduction data created.';
    RAISE NOTICE 'Project ID: %', v_project_id;
    RAISE NOTICE 'Volunteer ID: %', v_volunteer_id;
    RAISE NOTICE 'Check the UI now: the volunteer should appear in BOTH Morning and Evening slots.';
    RAISE NOTICE 'Then run the migration script: supabase/migrations/20260602002000_migrate_multiday_schedule_ids.sql';
END $$;
