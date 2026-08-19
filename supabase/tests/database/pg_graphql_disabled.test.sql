-- The platform uses PostgREST and server actions, not Supabase GraphQL. The
-- GraphQL extension must stay absent so its schema introspection cannot expose
-- otherwise-RLS-protected table metadata to browser roles.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(1);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_extension
    WHERE extname = 'pg_graphql'
  ),
  'unused pg_graphql extension remains disabled'
);

SELECT * FROM extensions.finish();

ROLLBACK;
