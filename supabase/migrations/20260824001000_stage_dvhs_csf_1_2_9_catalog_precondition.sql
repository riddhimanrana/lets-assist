-- Stage the catalog state that 20260824002008 was signed against.
--
-- 20260824002008 asserts the plugin catalog sits at
-- latest_version 1.1.0 / code_reference df7c59fd..., then raises when it does
-- not. No migration ever writes df7c59fd: 20260818040246 sets the catalog to
-- 1.1.0 / 4d1001e9..., and published-releases.json agrees after #270 reverted
-- #268's repin in a20d7aed. The integration was generated at 00:19 and merged
-- at 00:32 with that revert landing at 00:28 between them, so it froze a value
-- that was true in the repo for nine minutes and in no database ever.
--
-- The consequence is that 20260824002008 aborts on EVERY fresh database, so a
-- clean install or a full `db:validate` replay never reaches the 1.2.9
-- publication behind it. Marking it applied by hand repairs only the databases
-- someone remembers to repair; it leaves every future clean install broken.
--
-- 20260824002008 is signed and already merged, so it is not edited. Instead the
-- ledger reconstructs the exact state it was built to assert, immediately before
-- it runs. 20260824003000 restores the true reference immediately after, so the
-- phantom value exists only across those two steps and no environment is left
-- holding it.
--
-- Guarded both ways: this only moves a catalog that is on the known-true
-- reference, so re-running it, or running it on a database already past this
-- point, changes nothing.
UPDATE public.plugins
SET code_reference = 'df7c59fdd6bfce5898966e244ac0909d972473be',
    updated_at = now()
WHERE key = 'dvhs-csf'
  AND latest_version = '1.1.0'
  AND code_reference = '4d1001e9d3269b8bd28de93c071c6b4b216824fd';
