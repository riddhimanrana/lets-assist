-- Exercise exact repaired bodies, grant preservation and a real service RPC.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(81);
CREATE TEMP TABLE business_conflict_expectations(identity text,body_sha256 text,execution_acl text[]);
INSERT INTO business_conflict_expectations VALUES
('app_private.block_entitlement_write_during_plugin_transition()','2e26c078b2310619263b242128b5cb8451a31b2118e7d619ebf190a0bec9bd0d',ARRAY['postgres=X/postgres']::text[]),
('app_private.guard_paper_scan_registration_during_cleanup()','2ec95668bc6150aca923d8ea49e3b4579511afcdb5b08145bab207771d1d6d80',ARRAY['postgres=X/postgres']::text[]),
('app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)','200b68dc209fc22919df0c367091112d1aaa760a9902148cf39d539229b9263e',ARRAY['postgres=X/postgres']::text[]),
('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)','88b30719d0f54304b44bc19e28fb4af7a81aabfaa2481535efc45bdba12830cd',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_begin_submission_edit(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb)','7b59c49267a02b87b776d525932f7240488d29ea212513fb285d1f1ff9645513',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_commit_submission_edit(uuid,uuid,uuid,uuid,text)','9401bd36e04b18c938d5e7a84654c3b0d114e029088b9ddfeb749ddf4f53780a',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_confirm_workbook_profile_link(uuid,uuid,uuid,uuid,uuid,text)','155035cadc5b7bea413c6d0abc89711a04b758046054aacbec3d00b417b4c403',ARRAY['service_role=X/postgres']::text[]),
('plugin_data.csf_consume_sheet_source_evidence(uuid,uuid,uuid,uuid,uuid)','7176a6ff256d59c6ebb7e148f89739ae34a3657eff61368da757cb36d408c8ea',ARRAY['postgres=X/postgres']::text[]),
('plugin_data.csf_edit_activity_layout(uuid,uuid,uuid,uuid,bigint,text,jsonb)','f1071df83a6861978fc939cedd54ef40c6316a96b6e13fd181384a84f6aaf623',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_enforce_sheet_source_mapping_version()','f51b269272d7f14a9f00b2e663c5f74ebc3817ffe629cedfe9388513f0918d12',ARRAY['postgres=X/postgres']::text[]),
('plugin_data.csf_finish_publication_notification(uuid,uuid,uuid,text)','a5d853e067fd7254bfbfb3896a64e9ce31377cd7d8c0a1f8a21a76ebcd2c5719',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)','631af8bb5f959872d9d21b25fb407fffeebcec49c859ebd0635ea55d7268c462',ARRAY['postgres=X/postgres']::text[]),
('plugin_data.csf_merge_profiles_decision_stages_base(uuid,uuid,uuid,text,uuid)','505cbcca3265582b0bdd8f8051c49e8793912e594213ceac79abffd60e35bf49',ARRAY['postgres=X/postgres']::text[]),
('plugin_data.csf_prepare_announcement_attachment_restore(uuid,uuid,uuid,uuid,text,text)','4f92004211848d957f83dd055945e5e4673d1f0138b91d7531a3dea2573886b7',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_prepare_application_source_review_periods(uuid,uuid,uuid,integer)','48fa5483c89818505a4f401a8c5246b5d961c1945a67bf8a7577beb1a547509d',ARRAY['service_role=X/postgres']::text[]),
('plugin_data.csf_queue_sheet_sync_record_internal(uuid,uuid,text,uuid)','890d14a8fd3335d7d1af01e2c9081615f61704c5630900245da59fb31e24169a',ARRAY['postgres=X/postgres']::text[]),
('plugin_data.csf_queue_sheet_sync_snapshot_internal(uuid,uuid,text,uuid,jsonb)','4c402a789392576af2fa08c4aad1af5cb7dc6f20651fe2ce75ab63b82e97bec3',ARRAY['postgres=X/postgres']::text[]),
('plugin_data.csf_reconcile_attachment_restore_cleanup()','12d4e401c18910d923fd970af90d4c89b5b0aaeb41f4ad79c5369557b9723edd',ARRAY['postgres=X/postgres']::text[]),
('plugin_data.csf_record_communication_provider_event(uuid,text,text,text,timestamp with time zone,text,boolean,text,text,jsonb,uuid,uuid)','a93a3bb6197cfc7593a97b85363688ac2e58d63978ecdb3e2a0aa8b4d827d8be',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_refresh_sheet_source_drive_metadata(uuid,uuid,uuid,text,text,text,jsonb)','07ba957a2508d61463a828f4b47811df17bbca6376d369beef0ede8aa84adf2e',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_refresh_sheet_source_evidence(uuid,uuid,uuid,uuid,bigint,text,text,timestamp with time zone,text,boolean,text,text)','0d086e0834b846ff5ab52635303fb285d12dc91dd20c3c1dc978b68682849c25',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_register_sheet_source(uuid,uuid,uuid,text,jsonb)','8d47c198c2044fa0615e21f35cfba644a41b4b0d4220e8d21ae5579d35b4345d',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)','f6615b3b74c3eaee532fc4191cd174417e6d1d5305f294b3dd4c3c55561c8e29',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_resolve_post_publication_completion(uuid,uuid,uuid,uuid)','333628493bb77c54e2ca83a4edca7159a0fea4697a559cbf9b1433a970a24e7a',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_review_point_submission_revision_request(uuid,uuid,text,numeric,text,uuid,uuid,bigint,text)','3bf9afc4424ee43e8748c7497ad2dead3368afb5d3c2771d40075cbe35a3cfc4',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_set_application_decision_mapping(uuid,uuid,uuid,jsonb,integer)','82695c465f0b338749f9693ffad01817db076aa33cd8a7a8937dca99a809627a',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.csf_set_sheet_automatic_update_authorization_tab_base(uuid,uuid,uuid,integer,text,uuid,uuid)','86939cb4a8b741708e79f30de883393b7a7cbd3d8d2e9a5de880892354366c9f',ARRAY['postgres=X/postgres']::text[]),
('plugin_data.csf_validate_attachment_restore_preparation(uuid,uuid,uuid,uuid,text,text)','3e9134e61ad5889f15267963f1234d2fbce0895c27d4a9782c6977de353f3371',ARRAY['postgres=X/postgres']::text[]),
('plugin_data.csf_validate_submission_edit(uuid,uuid,uuid,bigint,jsonb,boolean)','704b4b614a5d496b0f0db1f61a4af4b1ea0bbcd41479e2366a94e474fb94dc4d',ARRAY['postgres=X/postgres']::text[]),
('plugin_data.review_dv_membership_application(uuid,uuid,uuid,jsonb)','8d2d730cc9e61d6207f7d0a6769234f634da1d566153aed05030b9d0aaab055c',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('plugin_data.save_dv_membership_application(uuid,uuid,uuid,jsonb,boolean)','484da5c8132271c816f0df00c238eb10acdb50b8b4fbd7f6ede4c6bd92b07e2f',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('private.cancel_project_transactional_legacy_status_fallback(uuid,text)','1bfdf84b518c76167cbd3d09ae95353645c9921c36ad8d6d043b7c61e0496b6f',ARRAY['postgres=X/postgres']::text[]),
('private.end_recurring_project_series_transactional()','19fb4ffa346e7cad37235c139415c66f158f8c8b707ebb06c282fb2ba7dfd8a2',ARRAY['postgres=X/postgres']::text[]),
('private.end_recurring_project_series_transactional(uuid,jsonb)','cfc7f198b6ac7f881aca722d87a8fa9666673e42dddf0bde98538b444505ef79',ARRAY['authenticated=X/postgres','postgres=X/postgres']::text[]),
('private.reject_project_signup(uuid)','a690620b66071df50d48e585a6d83c0cfb44f78c7097372e8dc071963b919b77',ARRAY['authenticated=X/postgres','postgres=X/postgres']::text[]),
('private.transition_project_status_transactional(uuid,text)','1414e97844d6273b0dd1dbc91129348a2f5d7afdf2af99f38a0e19bd52499367',ARRAY['authenticated=X/postgres','postgres=X/postgres']::text[]),
('public.begin_plugin_update_operation(uuid,text,text,uuid,uuid,text,text,text,jsonb)','c2332e207c54fb938187e025de0c76520dd8132f0b6d181cf2411cf6d9be37b0',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('public.complete_plugin_update_operation(uuid,uuid,text,jsonb,text)','945305b7b8c49f05711f68cae281e8f6236c88848540b3459e41119eef42279c',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
('public.set_plugin_application_runtime(uuid,text,text,text,boolean,uuid,uuid,boolean,text)','e8adf3db48636b10cd5e678ea647e17749c1569a19e973187605e30d7fe25536',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]);
SELECT extensions.is(
  (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
   FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(expected.identity)),
  expected.body_sha256, expected.identity||' changes only the reviewed conflict codes')
FROM business_conflict_expectations AS expected ORDER BY identity;
SELECT extensions.is(
  (SELECT ARRAY(SELECT entry FROM pg_catalog.unnest(proacl::text[]) AS entry ORDER BY entry)
   FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(expected.identity)),
  expected.execution_acl, expected.identity||' retains exact execution grants')
FROM business_conflict_expectations AS expected ORDER BY identity;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($rpc$SELECT public.complete_plugin_update_operation(
 '10070600-0000-4000-8000-000000000001','10070600-0000-4000-8000-000000000002','failed','{}',NULL)$rpc$,
 'PT409','plugin update operation does not match the lease token','missing lease returns one business conflict');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM private.plugin_update_operations
 WHERE id='10070600-0000-4000-8000-000000000001'),0::bigint,'refused completion creates no operation');
SET LOCAL ROLE anon;
SELECT extensions.throws_ok($rpc$SELECT public.complete_plugin_update_operation(
 '10070600-0000-4000-8000-000000000001','10070600-0000-4000-8000-000000000002','failed','{}',NULL)$rpc$,
 '42501',NULL,'browser execution remains denied');
RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
