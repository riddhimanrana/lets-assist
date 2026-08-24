-- Restore the true catalog reference staged by 20260824001000.
--
-- 20260824001000 briefly sets code_reference to the phantom df7c59fd... so the
-- signed 20260824002008 can assert the state it was built against. This puts the
-- catalog back on 4d1001e9..., which is what 20260818040246 established, what
-- every publish migration since carries, and what published-releases.json holds.
--
-- Ordered between 20260824002008 and 20260824050000 so the publication runs
-- against the staged state while everything downstream, including
-- 20260824050000's own precondition and
-- supabase/tests/database/plugin_release_dvhs_csf_1_2_9.test.sql, sees the truth.
--
-- Guarded, so it is a no-op on any database that never held the phantom value.
UPDATE public.plugins
SET code_reference = '4d1001e9d3269b8bd28de93c071c6b4b216824fd',
    updated_at = now()
WHERE key = 'dvhs-csf'
  AND latest_version = '1.1.0'
  AND code_reference = 'df7c59fdd6bfce5898966e244ac0909d972473be';
