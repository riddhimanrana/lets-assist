BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(5);

-- The request role runs under a safe-update policy that rejects an unqualified
-- DELETE before it executes, which is why csf_stage_sheet_application_decisions
-- failed with "DELETE requires a WHERE clause" through PostgREST while pgTAP
-- and psql passed. This file cannot reproduce that session policy: the
-- repository declares neither the module nor its setting, and guessing a name
-- here would assert nothing. So it pins the property that makes the RPC safe
-- under any such policy instead, and the coordinator calls the RPC through
-- PostgREST for the runtime half.

SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'plugin_data.csf_stage_sheet_application_decisions(uuid,uuid,uuid,uuid,jsonb,jsonb)'
    )
  ) NOT LIKE '%DELETE FROM pg_temp.%',
  'the staging RPC clears no plan table with an unqualified DELETE'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'plugin_data.csf_release_sheet_application_decisions(uuid,uuid,uuid,uuid,uuid[])'
    )
  ) NOT LIKE '%DELETE FROM pg_temp.%',
  'the release RPC clears no plan table with an unqualified DELETE'
);

-- Emptying the scratch tables is still the intent; this is a change of
-- statement, not of behaviour.
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'plugin_data.csf_stage_sheet_application_decisions(uuid,uuid,uuid,uuid,jsonb,jsonb)'
    )
  ) LIKE '%TRUNCATE TABLE pg_temp.csf_decision_source_plan;%',
  'the staging RPC still resets its source plan for each call'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'plugin_data.csf_stage_sheet_application_decisions(uuid,uuid,uuid,uuid,jsonb,jsonb)'
    )
  ) LIKE '%TRUNCATE TABLE pg_temp.csf_decision_row_plan;%',
  'the staging RPC still resets its row plan for each call'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'plugin_data.csf_release_sheet_application_decisions(uuid,uuid,uuid,uuid,uuid[])'
    )
  ) LIKE '%TRUNCATE TABLE pg_temp.csf_decision_release_plan;%',
  'the release RPC still resets its release plan for each call'
);

SELECT * FROM extensions.finish();
ROLLBACK;
