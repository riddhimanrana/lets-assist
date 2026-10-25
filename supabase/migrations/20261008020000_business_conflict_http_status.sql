-- Business conflicts must reach callers once. PostgREST retries engine 40001.
-- Pin each reviewed body and preserve attributes and execution grants exactly.
BEGIN;
SET LOCAL search_path=public,extensions;
DO $business_conflicts$
DECLARE
  specification record;
  routine_oid oid;
  before_body text;
  after_body text;
  before_definition text;
  after_definition text;
  before_metadata jsonb;
  current_metadata jsonb;
  current_acl text[];
  replacement_count integer;
BEGIN
  FOR specification IN
    SELECT * FROM (VALUES
    ('app_private.block_entitlement_write_during_plugin_transition()','c02dae672260eb26d580a1c0cda6298362143859a1ac583398761844b32b5431','2e26c078b2310619263b242128b5cb8451a31b2118e7d619ebf190a0bec9bd0d',1,ARRAY['postgres=X/postgres']::text[],'e91e5148aba8bb97af78d03faf94d57a36a22de6e514e8bcbaf77678d7706041'),
    ('app_private.guard_paper_scan_registration_during_cleanup()','e4582a96eb759f62aac1723524f8c483aa3f81f77f5a9337226ad2368acab042','2ec95668bc6150aca923d8ea49e3b4579511afcdb5b08145bab207771d1d6d80',1,ARRAY['postgres=X/postgres']::text[],'34b50eecce4797c9d06cb3777b96d8771521d1921f22ca6f0506b91187789bdc'),
    ('app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)','a51ed114406c431fdd44436f0852801f2d79259e675fa67e993520ac9466ecae','200b68dc209fc22919df0c367091112d1aaa760a9902148cf39d539229b9263e',1,ARRAY['postgres=X/postgres']::text[],'47ea70ae0d56d0be42679953927c990084cf836b5d4fa8e13adbf805180ef780'),
    ('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)','bccd657db22c073deec6b30b9541fa57ce93932d202a245305221e8bab0b19d7','88b30719d0f54304b44bc19e28fb4af7a81aabfaa2481535efc45bdba12830cd',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'f01902f60d9670927fac0aedd40baa1703ad8f2ec09ceb3ebc34cbd010f243f7'),
    ('plugin_data.csf_begin_submission_edit(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb)','5dc43bbc143a5f82bb724dd8d29cc8070db05e69d36a3fc174f9177f3e28ab30','7b59c49267a02b87b776d525932f7240488d29ea212513fb285d1f1ff9645513',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'26d364ff6678ebc9ac0c88f66d7de48cf0e1d7ff938f18b5e0427545d2672e9e'),
    ('plugin_data.csf_commit_submission_edit(uuid,uuid,uuid,uuid,text)','32f4670582f1d0438a6723377dcfd2f7a9d027938f7c8a9b26d432d4ef53a973','9401bd36e04b18c938d5e7a84654c3b0d114e029088b9ddfeb749ddf4f53780a',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'02041f81a3d6eed19d3d364c10c2aeeef30f6893affccb9aacca6167b6d935c7'),
    ('plugin_data.csf_confirm_workbook_profile_link(uuid,uuid,uuid,uuid,uuid,text)','16772298c5056bc746bcd2ceef1bf3b1b64253319f98ed5d5f5e530ec117070b','155035cadc5b7bea413c6d0abc89711a04b758046054aacbec3d00b417b4c403',1,ARRAY['service_role=X/postgres']::text[],'74b3ea09ff143ae83130fee5046d770236f2ea5a2f69a09f2444fcd92aa3041b'),
    ('plugin_data.csf_consume_sheet_source_evidence(uuid,uuid,uuid,uuid,uuid)','e82cd6223714cdc3f9c4e448f981f7c45fd78e5421c72384a03ee3c460be9945','7176a6ff256d59c6ebb7e148f89739ae34a3657eff61368da757cb36d408c8ea',6,ARRAY['postgres=X/postgres']::text[],'0c7f485ddd64ab4d2f06ef1359b9187b6ebbf962abd5985569930431536e523a'),
    ('plugin_data.csf_edit_activity_layout(uuid,uuid,uuid,uuid,bigint,text,jsonb)','d7315f1ac0c56c602b087efe1557050fa1c501866d73511d79b2bdf025cf1c87','f1071df83a6861978fc939cedd54ef40c6316a96b6e13fd181384a84f6aaf623',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'685eaf929519e1aa929f9f0e012f426167b311a3160ec790df88a5907d89f96b'),
    ('plugin_data.csf_enforce_sheet_source_mapping_version()','aa98c8de092a0fa15e2fe735787821cc41cf81f9520205d722a03251092f5820','f51b269272d7f14a9f00b2e663c5f74ebc3817ffe629cedfe9388513f0918d12',2,ARRAY['postgres=X/postgres']::text[],'64a5096acb8f9c356350aa2be94e275fc6e8671d4d5208f7ac22c184ca95b6b1'),
    ('plugin_data.csf_finish_publication_notification(uuid,uuid,uuid,text)','060d890f05e96491dad0460c726508d2312a932f0791bc9d93c71f090a52b5da','a5d853e067fd7254bfbfb3896a64e9ce31377cd7d8c0a1f8a21a76ebcd2c5719',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'ca1512eec4f0bcfb7f35989a7cc5e022ced3556bd77e1286ee32f42e00d7c7dd'),
    ('plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)','4ada82f12d4692e4b2d21e52cace4106a53bd45c178c04093fb4d0747338c490','631af8bb5f959872d9d21b25fb407fffeebcec49c859ebd0635ea55d7268c462',1,ARRAY['postgres=X/postgres']::text[],'36ae30cefbcabb9ba2b441b8033b8a240c5c764baab616acc133d1a061ee55ac'),
    ('plugin_data.csf_merge_profiles_decision_stages_base(uuid,uuid,uuid,text,uuid)','6734d1a2a2c6c8f5e3d8813732bca4ddc2503f09681897d602f74871801372ca','505cbcca3265582b0bdd8f8051c49e8793912e594213ceac79abffd60e35bf49',1,ARRAY['postgres=X/postgres']::text[],'b9c11ab372f534d36063c4136fc59cf5c971dfca8f5eadacec94700eecad673e'),
    ('plugin_data.csf_prepare_announcement_attachment_restore(uuid,uuid,uuid,uuid,text,text)','f14a4f38683f2f8d0b6c8221cc3b8ab80faad8f6cf26a146f12df788980992ef','4f92004211848d957f83dd055945e5e4673d1f0138b91d7531a3dea2573886b7',3,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'d9c93264c8d56579788e3400d5f9fa1a3b84703047df783cfbbd97b75a482c86'),
    ('plugin_data.csf_prepare_application_source_review_periods(uuid,uuid,uuid,integer)','b4534926a9693a8d2708e8f2d3632aec20c02ccbd3178ce7c8237f65556d3835','48fa5483c89818505a4f401a8c5246b5d961c1945a67bf8a7577beb1a547509d',1,ARRAY['service_role=X/postgres']::text[],'40d8c75fb1e280bec17e68bbb0453e596fa37b10e4977988e4cc613825f67ec4'),
    ('plugin_data.csf_queue_sheet_sync_record_internal(uuid,uuid,text,uuid)','db06bf806b28b1e7e9c0ebf9c9a7614fb2f63a2e17a22b0f0cc6ae18c82ceb55','890d14a8fd3335d7d1af01e2c9081615f61704c5630900245da59fb31e24169a',1,ARRAY['postgres=X/postgres']::text[],'f3caac43f30a12ee7a36bc75c7091e755f8356473bcc740dad84b66e240db90b'),
    ('plugin_data.csf_queue_sheet_sync_snapshot_internal(uuid,uuid,text,uuid,jsonb)','9ef0004ffa143d8cd5ac775ebff89caf1a658b174d3f4a1d42a51b1d8f0cac3d','4c402a789392576af2fa08c4aad1af5cb7dc6f20651fe2ce75ab63b82e97bec3',1,ARRAY['postgres=X/postgres']::text[],'1b962e4a9a98c77cbd60e8b665acb7b004c06ba02cac1994c6659bd7d4d5d0ad'),
    ('plugin_data.csf_reconcile_attachment_restore_cleanup()','2f2bae7900209b942c5ad918c53d983395f2cfc2ef2ad9058469c0f8b0100842','12d4e401c18910d923fd970af90d4c89b5b0aaeb41f4ad79c5369557b9723edd',2,ARRAY['postgres=X/postgres']::text[],'832e4fa516a0c3d809f9d25604e7c30b36d8f7f3acfd2479cfd2e1d16cfb5366'),
    ('plugin_data.csf_record_communication_provider_event(uuid,text,text,text,timestamp with time zone,text,boolean,text,text,jsonb,uuid,uuid)','81fd0cb2497e3f491069953f9ec706c244d9837c0df32fe2a70d56726170b745','a93a3bb6197cfc7593a97b85363688ac2e58d63978ecdb3e2a0aa8b4d827d8be',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'5e19c1ecceea664e4c1129f4f83e38499f450621a4b6cb39f614c37394956758'),
    ('plugin_data.csf_refresh_sheet_source_drive_metadata(uuid,uuid,uuid,text,text,text,jsonb)','b4c9e2ffce52b7b9fdf4438339361526b721b768c3d258d360e262969fac9dc9','07ba957a2508d61463a828f4b47811df17bbca6376d369beef0ede8aa84adf2e',2,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'9c925fa15e5b25862cb647cc0a791b1f35f6530524120e27cfdf50be858152f6'),
    ('plugin_data.csf_refresh_sheet_source_evidence(uuid,uuid,uuid,uuid,bigint,text,text,timestamp with time zone,text,boolean,text,text)','821644344586d589b69b2273a9812c9497da67670ce89065e3652a7b4956321d','0d086e0834b846ff5ab52635303fb285d12dc91dd20c3c1dc978b68682849c25',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'1914bdec3290c48cae88454ec3a25fb2eab2864319492485ceb6c15d77a3d5b6'),
    ('plugin_data.csf_register_sheet_source(uuid,uuid,uuid,text,jsonb)','b0f3e2607275ab54d29d08edcfd4a203751a7ad81a55a0e1c1fa5df488f63649','8d47c198c2044fa0615e21f35cfba644a41b4b0d4220e8d21ae5579d35b4345d',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'bbad3044d24a3d9a5e63860c22cdd73434a053c4a97dfcbfd44a8aa4959f18c5'),
    ('plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)','a203a705d7f5e3df8160ddbccbef46f6813df1a5af60b75f862e693fb3535589','f6615b3b74c3eaee532fc4191cd174417e6d1d5305f294b3dd4c3c55561c8e29',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'85398883c5cb1500c85a8f5dd83ecfa65fc051e84abba1f18159476025da9b84'),
    ('plugin_data.csf_resolve_post_publication_completion(uuid,uuid,uuid,uuid)','b604bfc312a109688ceef331195013b23af320d618d57da15c3b481ac32b8a9c','333628493bb77c54e2ca83a4edca7159a0fea4697a559cbf9b1433a970a24e7a',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'c377ea8ae397ad4e0649dd7b60b9ab5b1f699b12f5b5f67207f3a395c71321d9'),
    ('plugin_data.csf_review_point_submission_revision_request(uuid,uuid,text,numeric,text,uuid,uuid,bigint,text)','b11287e06265979375e9a07c78172a974a0551a5f2edc15a554c1c4cd676217b','3bf9afc4424ee43e8748c7497ad2dead3368afb5d3c2771d40075cbe35a3cfc4',3,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'a0cd2eb92ebefac763b7935ea44b1a089fe34507ca53e05c2f7a5f5e6f1b9bfb'),
    ('plugin_data.csf_set_application_decision_mapping(uuid,uuid,uuid,jsonb,integer)','6e7581d06936a94bc070b532b5d0d0abeef2e3828152a05834a4028ba8458bed','82695c465f0b338749f9693ffad01817db076aa33cd8a7a8937dca99a809627a',3,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'7032aa1290fc77d44a65e481d7a9fce4bebd951474ee0d51742f24eb14c37745'),
    ('plugin_data.csf_set_sheet_automatic_update_authorization_tab_base(uuid,uuid,uuid,integer,text,uuid,uuid)','c61346f936b0f19b59b0aa976dc1acb91d2afc3bcf253e5685aeaaf9d911ecd7','86939cb4a8b741708e79f30de883393b7a7cbd3d8d2e9a5de880892354366c9f',1,ARRAY['postgres=X/postgres']::text[],'6872f08367a41f81f74103ae29088812c4b5049a345b6bf155487691f17b83c0'),
    ('plugin_data.csf_validate_attachment_restore_preparation(uuid,uuid,uuid,uuid,text,text)','e433f06b3bbbe5c445ef590b371711ec1d04a4d27beed67c6eddde75089818ec','3e9134e61ad5889f15267963f1234d2fbce0895c27d4a9782c6977de353f3371',1,ARRAY['postgres=X/postgres']::text[],'29fd0ed1e96a04d1d7794f0c33a84c5fdc7fc23332ac00320104926c3a67618f'),
    ('plugin_data.csf_validate_submission_edit(uuid,uuid,uuid,bigint,jsonb,boolean)','c4610d4f272b15baba806b33fa66697a2965c98f80632cfe359c9c3ef619a6d3','704b4b614a5d496b0f0db1f61a4af4b1ea0bbcd41479e2366a94e474fb94dc4d',1,ARRAY['postgres=X/postgres']::text[],'11d82405f35457830354c72dd1166bcd575d07a5f38b6d92cef72175000c824c'),
    ('plugin_data.review_dv_membership_application(uuid,uuid,uuid,jsonb)','c98578456f87f664c06ef4cfd8a9c5884419f802b7b345da2125c6a4ad85bb70','8d2d730cc9e61d6207f7d0a6769234f634da1d566153aed05030b9d0aaab055c',2,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'ea42fd8aa4d7fe85992af9376709303a1eb3ff86c0c731e4332c5d3e2b5af14a'),
    ('plugin_data.save_dv_membership_application(uuid,uuid,uuid,jsonb,boolean)','4bc35824cf90e2a2c559089239aebdf289146256b97d771668fac814e179ccb6','484da5c8132271c816f0df00c238eb10acdb50b8b4fbd7f6ede4c6bd92b07e2f',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'ca237910ad07be3b3cf93d2d419e8ef1a0d21f87045461c668c1d507b88bc5fc'),
    ('private.cancel_project_transactional_legacy_status_fallback(uuid,text)','001ccf9c0f4f0c0f4c95e271e41742f8b2e9564898af062c00bd905341e0ee6f','1bfdf84b518c76167cbd3d09ae95353645c9921c36ad8d6d043b7c61e0496b6f',1,ARRAY['postgres=X/postgres']::text[],'a3093d8dae3aa8ef08725b07c8663e334f4f76e623605f281b1c65d44b31c20a'),
    ('private.end_recurring_project_series_transactional()','db8c4aabcfe1f0f2b5f74735bb2dc01fe580565834d2a9a5e4c4929eb6a8c1ad','19fb4ffa346e7cad37235c139415c66f158f8c8b707ebb06c282fb2ba7dfd8a2',1,ARRAY['postgres=X/postgres']::text[],'ef74e6b6d162eceb84ff7a87c783defcdc6efbaf26d11446e565dd3b69539d99'),
    ('private.end_recurring_project_series_transactional(uuid,jsonb)','779854dc90b0f2463b70a96106065b25f95ba48aff0e61dfbfd0b4d8ad9dfa4b','cfc7f198b6ac7f881aca722d87a8fa9666673e42dddf0bde98538b444505ef79',8,ARRAY['authenticated=X/postgres','postgres=X/postgres']::text[],'c47e83e44a430d9ed820c5c4d36687d46e2f8e607c69a5fa77a95d567fcff978'),
    ('private.reject_project_signup(uuid)','abe2c30e21ea6c20af675465dd3b6ad3d33a4823602e7f129189254d691d42b1','a690620b66071df50d48e585a6d83c0cfb44f78c7097372e8dc071963b919b77',2,ARRAY['authenticated=X/postgres','postgres=X/postgres']::text[],'c030dedc4ac31f2a8b19560d3574048376636784bab9eda839ca43b207412163'),
    ('private.transition_project_status_transactional(uuid,text)','a07b567f18980ada5a74ef61717e8eed837ec673ede8fdff40e5b995a7330a9c','1414e97844d6273b0dd1dbc91129348a2f5d7afdf2af99f38a0e19bd52499367',1,ARRAY['authenticated=X/postgres','postgres=X/postgres']::text[],'ed052a384171db4824efffc43d6abcdf35df334e4b93b54b6308b0c35c81795b'),
    ('public.begin_plugin_update_operation(uuid,text,text,uuid,uuid,text,text,text,jsonb)','092726f84b088185fa3d18b2f27f7aa259fe5a67e19f4c8cf80fc17dd25e4040','c2332e207c54fb938187e025de0c76520dd8132f0b6d181cf2411cf6d9be37b0',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'31928dd62ac8467afc269c513e6ba920ae97c8d10c20d026249b75a1624cb2ff'),
    ('public.complete_plugin_update_operation(uuid,uuid,text,jsonb,text)','4b9c3e21d4bd12f055f7e240b746f69f4b5d2086f4a9d868e13664ce67959302','945305b7b8c49f05711f68cae281e8f6236c88848540b3459e41119eef42279c',2,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'3561ad0205be849769e244c4baa78f2eef5214652a0e103591ad6b7de77dd352'),
    ('public.set_plugin_application_runtime(uuid,text,text,text,boolean,uuid,uuid,boolean,text)','9cb046d3a8a123eab37018a610076edb3cdacc4c0cf718e07f97a24cf502342d','e8adf3db48636b10cd5e678ea647e17749c1569a19e973187605e30d7fe25536',1,ARRAY['postgres=X/postgres','service_role=X/postgres']::text[],'63dc31d7e1ae6737de43cad135d5a23fb45b3df5b7cef9ea77f7a75807193932')
    ) AS reviewed(identity, before_sha256, after_sha256, replacements, execution_acl, definition_sha256)
  LOOP
    routine_oid := pg_catalog.to_regprocedure(specification.identity)::oid;
    SELECT routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid),
      to_jsonb(routine)-'prosrc'-'proacl'-'proargdefaults',
      ARRAY(SELECT entry FROM pg_catalog.unnest(routine.proacl::text[]) AS entry ORDER BY entry)
    INTO before_body, before_definition, before_metadata, current_acl
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_language AS language ON language.oid=routine.prolang
    WHERE routine.oid=routine_oid AND routine.proowner='postgres'::regrole
      AND language.lanname='plpgsql';
    IF NOT FOUND OR current_acl IS DISTINCT FROM specification.execution_acl
      OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(before_definition,'UTF8')),'hex')
        IS DISTINCT FROM specification.definition_sha256
      OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(before_body,'UTF8')),'hex')
        IS DISTINCT FROM specification.before_sha256 THEN
      RAISE EXCEPTION 'Business-conflict function differs from its reviewed baseline: %', specification.identity
        USING ERRCODE='55000';
    END IF;
    SELECT count(*) INTO replacement_count
    FROM pg_catalog.regexp_matches(before_body, '(ERRCODE[[:space:]]*=[[:space:]]*)''40001''', 'gi');
    after_body := pg_catalog.regexp_replace(before_body,
      '(ERRCODE[[:space:]]*=[[:space:]]*)''40001''', '\1''PT409''', 'gi');
    IF replacement_count<>specification.replacements
      OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(after_body,'UTF8')),'hex')
        <>specification.after_sha256
      OR (length(before_definition)-length(replace(before_definition,before_body,'')))<>length(before_body) THEN
      RAISE EXCEPTION 'Business-conflict replacement differs from review: %', specification.identity
        USING ERRCODE='55000';
    END IF;
    EXECUTE replace(before_definition,before_body,after_body);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, postgres',specification.identity);
    IF 'postgres=X/postgres'=ANY(specification.execution_acl) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO postgres',specification.identity);
    END IF;
    IF 'authenticated=X/postgres'=ANY(specification.execution_acl) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',specification.identity);
    END IF;
    IF 'service_role=X/postgres'=ANY(specification.execution_acl) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',specification.identity);
    END IF;
    SELECT pg_catalog.pg_get_functiondef(routine.oid),
      to_jsonb(routine)-'prosrc'-'proacl'-'proargdefaults',
      ARRAY(SELECT entry FROM pg_catalog.unnest(routine.proacl::text[]) AS entry ORDER BY entry)
    INTO after_definition,current_metadata,current_acl
    FROM pg_catalog.pg_proc AS routine WHERE routine.oid=routine_oid;
    IF replace(after_definition,after_body,before_body) IS DISTINCT FROM before_definition
      OR current_metadata IS DISTINCT FROM before_metadata
      OR current_acl IS DISTINCT FROM specification.execution_acl THEN
      RAISE EXCEPTION 'Business-conflict repair changed function metadata: %',specification.identity
        USING ERRCODE='55000';
    END IF;
  END LOOP;
END;
$business_conflicts$;
NOTIFY pgrst, 'reload schema';
COMMIT;
