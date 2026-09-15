export const publicationNotificationDefinitions = [
  [
    "plugin_data.csf_authorize_communication_dispatch(uuid,uuid,text,text)",
    "7078df9d6aed5e702739980af389c20c",
    true,
  ],
  [
    "plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)",
    "45955f667a0dc934e86b2980a695d683",
    true,
  ],
  [
    "plugin_data.csf_claim_publication_notifications(integer)",
    "aae408e8af045318b3333ac006d56f57",
    true,
  ],
  [
    "plugin_data.csf_finish_publication_notification(uuid,uuid,uuid,text)",
    "10a96b074302b702b7d5235aa692c52b",
    true,
  ],
  [
    "plugin_data.csf_publication_account_is_owned(uuid,uuid,uuid)",
    "4d5c6a76ec82d38cec7947f8e3d630fd",
    false,
  ],
  [
    "plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)",
    "d611bc91327412cad303c1e17123794f",
    false,
  ],
  [
    "plugin_data.csf_publication_recipient_allowed(uuid,text,uuid,uuid)",
    "410dfba2b96511bae6548134e51539c4",
    false,
  ],
  [
    "plugin_data.csf_record_publication_notifications()",
    "396db81ca1f3953148782858f9185223",
    false,
  ],
];

export function publicationNotificationPosture(
  relationQuery,
  deliveryDigest = "31fbae5b2e33bf8be6fa203c76489430",
) {
  const relations = relationQuery
    .replace(
      "app_private.csf_release_worker_controls",
      "plugin_data.csf_publication_events",
    )
    .replace(
      "app_private.csf_release_worker_receipts",
      "plugin_data.csf_publication_notification_deliveries",
    );
  return `AND (SELECT count(*)=2 AND bool_and(runtime_denied AND digest=CASE relname
    WHEN 'csf_publication_events' THEN 'bb442786fe77c77ce3adae4aa0e84ac8'
    WHEN 'csf_publication_notification_deliveries' THEN '${deliveryDigest}'
    ELSE '' END) FROM (${relations}) publication_relations)
  AND (SELECT count(*)=2 AND bool_and(
    t.tgfoid=to_regprocedure('plugin_data.csf_record_publication_notifications()')
    AND t.tgenabled='O' AND t.tgtype=21 AND NOT t.tgisinternal
    AND t.tgconstraint=0 AND t.tgqual IS NULL AND octet_length(t.tgargs)=0
    AND t.tgattr::text=a.attnum::text
  ) FROM (VALUES
    ('plugin_data.csf_announcements','csf_announcements_publication_notifications'),
    ('plugin_data.csf_opportunities','csf_activities_publication_notifications')
  ) expected(relation,trigger_name)
  JOIN pg_trigger t ON t.tgrelid=to_regclass(expected.relation) AND t.tgname=expected.trigger_name
  JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attname='status' AND NOT a.attisdropped)
  AND EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d
    ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=to_regclass('public.notification_settings')
      AND a.attname='organization_updates' AND NOT a.attisdropped
      AND a.atttypid='boolean'::regtype AND a.attnotnull
      AND a.attgenerated='' AND a.attidentity=''
      AND pg_get_expr(d.adbin,d.adrelid)='true')`;
}
