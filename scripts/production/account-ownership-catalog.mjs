export const ownershipDefinitions = [
  [
    "plugin_data.csf_search_organization_accounts(uuid,uuid,text)",
    "0b249714f8fcdc01cf7d820ec8d2e9b5",
    true,
  ],
  [
    "plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid)",
    "7bed352f081542f0a3f6313c8a07e77e",
    false,
  ],
  [
    "plugin_data.csf_confirm_class_code_account_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text,text)",
    "6f01ca83f16592b23c719901f1abbd9e",
    true,
  ],
  [
    "plugin_data.csf_confirm_class_code_account_name_match_v4(uuid,uuid,uuid,text,uuid,uuid,text,text,text)",
    "25b71a8a3298d633ead87a999576725b",
    true,
  ],
  [
    "plugin_data.csf_confirm_class_code_account_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text,text)",
    "9f36bf20631ca004e9ac9b29cd5b5fb7",
    false,
  ],
  [
    "plugin_data.csf_reclassify_captured_application_contacts(uuid)",
    "de84e1f33a768bb82c46775ac380e401",
    false,
  ],
  [
    "plugin_data.csf_hold_unproven_account_connections(uuid,uuid[])",
    "73996422d583aa8144f87b04cb68d6a1",
    false,
  ],
];

export const reportedContactColumnsPosture = `AND 2 = (
  SELECT count(*) FROM pg_attribute a WHERE a.attrelid='plugin_data.csf_profiles'::regclass
    AND a.attname IN ('reported_application_school_email','reported_application_personal_email')
    AND a.atttypid='text'::regtype AND NOT a.attnotnull AND NOT a.attisdropped
) AND NOT EXISTS (
  SELECT 1 FROM (VALUES ('anon'),('authenticated')) roles(name)
  WHERE has_table_privilege(roles.name,'plugin_data.csf_profiles','SELECT,INSERT,UPDATE,DELETE')
    OR has_any_column_privilege(roles.name,'plugin_data.csf_profiles','SELECT,INSERT,UPDATE')
)`;
