BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(9);

SELECT extensions.ok(
  has_function_privilege('authenticated', 'public.is_super_admin()', 'EXECUTE'),
  'authenticated users can evaluate the RLS helper'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.is_super_admin()', 'EXECUTE'),
  'anonymous users cannot call the helper'
);

SET LOCAL ROLE authenticated;

SET LOCAL "request.jwt.claims" =
  '{"role":"authenticated","app_metadata":{"is_super_admin":true}}';
SELECT extensions.ok(
  public.is_super_admin(),
  'the boolean app_metadata shape grants super-admin authority'
);

SET LOCAL "request.jwt.claims" =
  '{"role":"authenticated","app_metadata":{"role":"super_admin"}}';
SELECT extensions.ok(
  public.is_super_admin(),
  'the role-only app_metadata shape grants super-admin authority'
);

SET LOCAL "request.jwt.claims" =
  '{"role":"authenticated","app_metadata":{"role":"  SUPER_ADMIN  "}}';
SELECT extensions.ok(
  public.is_super_admin(),
  'the trusted role shape is normalized like the server helper'
);

SET LOCAL "request.jwt.claims" =
  '{"role":"authenticated","app_metadata":{"role":"\t\nSUPER_ADMIN\r\f"}}';
SELECT extensions.ok(
  public.is_super_admin(),
  'ECMAScript non-space whitespace is normalized like String.trim()'
);

SET LOCAL "request.jwt.claims" =
  U&'{"role":"authenticated","app_metadata":{"role":"SUPER_ADM\0130N"}}';
SELECT extensions.ok(
  NOT public.is_super_admin(),
  'Unicode case folding cannot turn a malformed role into ASCII super_admin'
);

SET LOCAL "request.jwt.claims" =
  '{"role":"authenticated","user_metadata":{"is_super_admin":true,"role":"super_admin"}}';
SELECT extensions.ok(
  NOT public.is_super_admin(),
  'self-editable user_metadata never grants authority'
);

SET LOCAL "request.jwt.claims" =
  '{"role":"super_admin","is_super_admin":true,"app_metadata":{"is_super_admin":"true","role":"member"}}';
SELECT extensions.ok(
  NOT public.is_super_admin(),
  'top-level and malformed app_metadata values fail closed'
);

SELECT * FROM extensions.finish();

ROLLBACK;
