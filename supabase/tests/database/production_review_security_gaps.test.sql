BEGIN;

SELECT extensions.plan(10);

SELECT extensions.has_column(
  'public',
  'project_paper_scan_batches',
  'extraction_claim_id',
  'paper scan extraction batches carry an ownership token'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'anonymous clients cannot append CSF preview rows'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated clients cannot append CSF preview rows'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'the server can append CSF preview rows'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_apply_import_annotation_interpretation(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot settle CSF import annotations'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_apply_import_annotation_interpretation(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot settle CSF import annotations'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_apply_import_annotation_interpretation(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) AND has_function_privilege(
    'service_role',
    'plugin_data.csf_review_import_annotation(uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'the server must use the audited officer annotation review boundary'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_refresh_sheet_source_evidence(uuid,uuid,uuid,uuid,bigint,text,text,timestamptz,text,boolean,text,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot refresh CSF source evidence'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_refresh_sheet_source_evidence(uuid,uuid,uuid,uuid,bigint,text,text,timestamptz,text,boolean,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot refresh CSF source evidence'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_refresh_sheet_source_evidence(uuid,uuid,uuid,uuid,bigint,text,text,timestamptz,text,boolean,text,text)',
    'EXECUTE'
  ),
  'the server can refresh CSF source evidence'
);

SELECT * FROM extensions.finish();
ROLLBACK;
