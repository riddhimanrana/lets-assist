BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(15);

SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_index WHERE indexrelid =
    to_regclass('plugin_data.csf_application_decision_sync_rows_org_run_idx')
    AND indisvalid AND indisready
), 'the decision receipt index is valid and ready');
SELECT extensions.ok(NOT has_function_privilege('anon',
  'plugin_data.csf_sheet_application_decision_run_receipt(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated',
  'plugin_data.csf_sheet_application_decision_run_receipt(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role',
  'plugin_data.csf_sheet_application_decision_run_receipt(uuid,uuid)','EXECUTE'),
  'the receipt primitive remains internal to reviewed decision operations');

INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
 ('fb910000-0000-4000-8000-000000000001','Receipt index fixture A','receipt-index-fixture-a','school','839101'),
 ('fb910000-0000-4000-8000-000000000002','Receipt index fixture B','receipt-index-fixture-b','school','839102');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester) VALUES
 ('fb920000-0000-4000-8000-000000000001','fb910000-0000-4000-8000-000000000001','F30','Fall 2030','2030-2031','fall'),
 ('fb920000-0000-4000-8000-000000000002','fb910000-0000-4000-8000-000000000002','F30','Fall 2030','2030-2031','fall');
INSERT INTO plugin_data.csf_sheet_sources(id,organization_id,title,provider,source_type,drive_file_id,spreadsheet_id) VALUES
 ('fb930000-0000-4000-8000-000000000001','fb910000-0000-4000-8000-000000000001','Synthetic receipt source A','google_sheets','application_responses','fixture-a','fixture-a'),
 ('fb930000-0000-4000-8000-000000000002','fb910000-0000-4000-8000-000000000002','Synthetic receipt source B','google_sheets','application_responses','fixture-b','fixture-b');

CREATE TEMP TABLE receipt_fixture AS
 SELECT n,
   ('fb910000-0000-4000-8000-' || lpad((1+n%2)::text,12,'0'))::uuid AS organization_id,
   ('fb920000-0000-4000-8000-' || lpad((1+n%2)::text,12,'0'))::uuid AS term_id,
   ('fb930000-0000-4000-8000-' || lpad((1+n%2)::text,12,'0'))::uuid AS source_id,
   md5('receipt-run-'||n)::uuid AS run_id,
   md5('receipt-source-'||n)::uuid AS run_source_id
 FROM generate_series(1,200) n;
INSERT INTO plugin_data.csf_application_decision_sync_runs
 (id,organization_id,term_id,request_id,request_fingerprint,status,unmatched_count)
 SELECT run_id,organization_id,term_id,run_id,repeat('a',64),'completed',100 FROM receipt_fixture;
INSERT INTO plugin_data.csf_application_decision_sync_sources
 (id,organization_id,run_id,source_id,read_status,spreadsheet_file_id,sheet_tab_name,
  requested_range,content_hash,mapping_version,provider_version)
 SELECT run_source_id,organization_id,run_id,source_id,'read','fixture','Responses',
   'A1:A100',repeat('b',64),'fixture-v1','1' FROM receipt_fixture;
INSERT INTO plugin_data.csf_application_decision_sync_rows
 (organization_id,run_id,run_source_id,observed_row_number,match_basis,outcome,decision)
 SELECT organization_id,run_id,run_source_id,row_number,'unmatched','unmatched','unreviewed'
 FROM receipt_fixture CROSS JOIN generate_series(1,100) row_number;
ANALYZE plugin_data.csf_application_decision_sync_rows;

CREATE TEMP TABLE receipt_results AS SELECT n,organization_id,run_id,
 plugin_data.csf_sheet_application_decision_run_receipt(organization_id,run_id) AS receipt
 FROM receipt_fixture WHERE n IN (1,2);
SELECT extensions.is((SELECT jsonb_array_length(receipt->'rows') FROM receipt_results WHERE n=1),100,
  'one receipt returns only its hundred rows among twenty thousand');
SELECT extensions.is((SELECT jsonb_array_length(receipt->'sources') FROM receipt_results WHERE n=1),1,
  'one receipt returns its source evidence');
SELECT extensions.is((SELECT jsonb_agg(item->'observedRowNumber' ORDER BY ord)
 FROM receipt_results,jsonb_array_elements(receipt->'rows') WITH ORDINALITY AS e(item,ord) WHERE n=1),
 (SELECT jsonb_agg(n) FROM generate_series(1,100) n), 'receipt row order stays unchanged');
SELECT extensions.is((SELECT receipt->'counts'->>'unmatched' FROM receipt_results WHERE n=1),'100',
  'receipt aggregate counts stay unchanged');
SELECT extensions.is((SELECT receipt->>'status' FROM receipt_results WHERE n=1),'completed',
  'receipt status stays unchanged');
SELECT extensions.ok(plugin_data.csf_sheet_application_decision_run_receipt(
 'fb910000-0000-4000-8000-000000000001',(SELECT run_id FROM receipt_fixture WHERE n=1)) IS NULL,
 'a run belonging to the other tenant is not returned');
SELECT extensions.is((SELECT receipt->>'runId' FROM receipt_results WHERE n=2),
 (SELECT run_id::text FROM receipt_fixture WHERE n=2), 'a second tenant receives its own run');
SELECT extensions.is((SELECT array_agg(key ORDER BY key)
 FROM receipt_results,jsonb_object_keys(receipt->'rows'->0) key WHERE n=1),
 ARRAY['applicationId','appliedToReleased','blockReason','decision','matchBasis','observedRowNumber','outcome','retractedRelease']::text[],
 'the bounded receipt preserves its result fields');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_application_decision_sync_rows SET decision='accepted'
 WHERE run_id=md5('receipt-run-1')::uuid$$,'55000','CSF application decision evidence is immutable.',
 'the index change does not allow rewriting retained decisions');
SELECT extensions.throws_ok($$DELETE FROM plugin_data.csf_application_decision_sync_rows
 WHERE run_id=md5('receipt-run-1')::uuid$$,'55000','CSF application decision evidence is immutable.',
 'the index change does not allow deleting retained decisions');

CREATE TEMP TABLE receipt_plan(plan jsonb);
DO $$ DECLARE v_plan jsonb; BEGIN
 EXECUTE $query$EXPLAIN (FORMAT JSON) SELECT observed_row_number,application_id,match_basis,outcome,
 decision,block_reason,applied_to_released,retracted_release
 FROM plugin_data.csf_application_decision_sync_rows
 WHERE organization_id='fb910000-0000-4000-8000-000000000002'::uuid
   AND run_id=md5('receipt-run-1')::uuid ORDER BY observed_row_number$query$ INTO v_plan;
 INSERT INTO receipt_plan VALUES(v_plan);
END $$;
SELECT extensions.ok((SELECT jsonb_path_exists(plan,
 '$.** ? (@."Index Name" == "csf_application_decision_sync_rows_org_run_idx")') FROM receipt_plan),
 'the representative receipt query uses the tenant and run index');
SELECT extensions.ok((SELECT NOT jsonb_path_exists(plan,
 '$.** ? (@."Node Type" == "Seq Scan" && @."Relation Name" == "csf_application_decision_sync_rows")') FROM receipt_plan),
 'one receipt no longer needs a full evidence-table scan');

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT plugin_data.csf_sheet_application_decision_run_receipt(
 'fb910000-0000-4000-8000-000000000002',md5('receipt-run-1')::uuid)$$,'42501',NULL,
 'a browser role cannot call the receipt primitive');
RESET ROLE;

-- Report runtime evidence separately from the semantic and plan assertions.
CREATE TEMP TABLE receipt_samples(ms numeric);
DO $$ DECLARE v_start timestamptz; v_receipt jsonb; i integer; BEGIN
 FOR i IN 1..35 LOOP
   v_start := clock_timestamp();
   v_receipt := plugin_data.csf_sheet_application_decision_run_receipt(
     'fb910000-0000-4000-8000-000000000002',md5('receipt-run-1')::uuid);
   IF i > 5 THEN INSERT INTO receipt_samples VALUES(extract(epoch FROM clock_timestamp()-v_start)*1000); END IF;
 END LOOP;
END $$;
SELECT extensions.diag(format('receipt fixture: 200 runs, 20000 rows, 5 warmups, %s samples, p95=%s ms, index=%s bytes',
 count(*),round((percentile_cont(0.95) WITHIN GROUP(ORDER BY ms))::numeric,3),
 pg_relation_size('plugin_data.csf_application_decision_sync_rows_org_run_idx'::regclass))) FROM receipt_samples;
SELECT * FROM extensions.finish();
ROLLBACK;
