// The isolated launcher installs these local-only seed helpers. Remove them
// within the verification transaction, then roll back so browser fixtures can
// still use them. Production catalog checks never use this wrapper.
export const localFixtureFunctions = [
  "csf_seed_synthetic_import_fixture(uuid, jsonb, jsonb, jsonb)",
  "csf_seed_reset_synthetic_import(uuid)",
  "csf_assert_fixture_owner(text, regclass, uuid, uuid)",
  "csf_assert_fixture_reference(text, uuid, regclass, uuid, boolean)",
  "csf_assert_fixture_keys(text, jsonb, text[])",
  "csf_assert_synthetic_fixture_scope(uuid)",
  "csf_is_synthetic_fixture_id(uuid)",
];

export function isolatedReleaseCatalogQuery(catalog) {
  return [
    "BEGIN;",
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '30s';",
    ...localFixtureFunctions.map(
      (signature) => `DROP FUNCTION IF EXISTS plugin_data.${signature};`,
    ),
    catalog,
    "ROLLBACK;",
  ].join("\n");
}
