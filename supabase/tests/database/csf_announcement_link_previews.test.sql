BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(4);

SELECT extensions.has_table(
  'plugin_data',
  'csf_announcement_link_previews',
  'published announcement link metadata has a dedicated server-owned table'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'anon',
    'plugin_data.csf_announcement_link_previews',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'anonymous visitors cannot query or mutate link preview storage directly'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated',
    'plugin_data.csf_announcement_link_previews',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'authenticated browsers cannot query or mutate link preview storage directly'
);

SELECT extensions.ok(
  has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_link_previews',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'the server can maintain and safely project announcement link previews'
);

SELECT * FROM extensions.finish();
ROLLBACK;
