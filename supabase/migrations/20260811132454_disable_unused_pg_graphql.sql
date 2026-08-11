-- Let's Assist does not expose or consume Supabase's GraphQL endpoint. Keeping
-- pg_graphql installed still makes every selectable table discoverable to
-- client roles through schema introspection, which produces security-advisor
-- warnings even though RLS remains the row-access boundary.
--
-- RESTRICT is intentional: if a future environment adds a real dependency on
-- an extension-owned object, the migration must fail for review instead of
-- cascading into unrelated objects.
DROP EXTENSION IF EXISTS pg_graphql RESTRICT;
