-- Durable account-removal state and the shared write fence. The following
-- operation migration owns preflight, atomic cleanup, and external retries.
BEGIN;

CREATE TABLE app_private.account_deletion_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL UNIQUE,
  requested_by uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('self_delete', 'admin_blacklist')),
  delete_projects boolean NOT NULL DEFAULT true,
  phase text NOT NULL CHECK (phase IN ('database_pending', 'blocked', 'external_pending', 'completed')),
  db_transaction_id bigint,
  deleted_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(deleted_counts) = 'object'),
  blockers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(blockers) = 'object'),
  safe_error_code text CHECK (safe_error_code IN ('database_phase_failed', 'storage_cleanup_failed', 'auth_cleanup_failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  database_completed_at timestamptz,
  completed_at timestamptz,
  CHECK ((claim_token IS NULL) = (lease_until IS NULL)),
  CHECK (phase <> 'completed' OR completed_at IS NOT NULL)
);
COMMENT ON TABLE app_private.account_deletion_operations IS
  'Service-owned account deletion intent and recovery receipt. Target and actor UUIDs deliberately survive Auth deletion. Never store credentials, raw provider errors, or private plugin rows here.';
CREATE INDEX account_deletion_operations_pending_idx
 ON app_private.account_deletion_operations (updated_at, id) WHERE phase = 'external_pending';

CREATE TABLE app_private.account_deletion_storage_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES app_private.account_deletion_operations(id) ON DELETE CASCADE,
  bucket_id text NOT NULL CHECK (bucket_id IN ('avatars', 'data-exports')),
  object_name text NOT NULL CHECK (length(object_name) BETWEEN 1 AND 1024),
  object_id uuid NOT NULL,
  deleted_at timestamptz,
  UNIQUE (operation_id, bucket_id, object_name)
);
ALTER TABLE app_private.account_deletion_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.account_deletion_storage_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.account_deletion_operations, app_private.account_deletion_storage_objects
 FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION app_private.account_deletion_actor_is_active(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT p_user_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM app_private.account_deletion_operations operation
   WHERE operation.target_user_id = p_user_id
     AND operation.phase IN ('database_pending', 'external_pending', 'completed')
 );
$$;
REVOKE ALL ON FUNCTION app_private.account_deletion_actor_is_active(uuid)
 FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.account_deletion_actor_is_active(uuid) TO service_role;
COMMENT ON FUNCTION app_private.account_deletion_actor_is_active(uuid) IS
 'Acquire lets-assist-account-write:{actor UUID} advisory transaction lock before this predicate in a write transaction. False for pending or completed account removal, including retained blacklisted Auth rows.';

CREATE FUNCTION public.account_deletion_pending()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT NOT app_private.account_deletion_actor_is_active(auth.uid()); $$;
REVOKE ALL ON FUNCTION public.account_deletion_pending() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_pending() TO authenticated;

CREATE FUNCTION app_private.guard_account_deletion_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE actor_id uuid := auth.uid();
BEGIN
 IF actor_id IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || actor_id::text, 0));
   IF NOT app_private.account_deletion_actor_is_active(actor_id) THEN
     RAISE EXCEPTION 'Account deletion is pending or complete.' USING ERRCODE = '42501';
   END IF;
 END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_private.guard_account_deletion_write() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.guard_account_deletion_write() TO service_role;

CREATE FUNCTION app_private.guard_account_deletion_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
 new_values jsonb := to_jsonb(NEW);
 old_values jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 target_id uuid;
BEGIN
 FOR target_id IN
   SELECT DISTINCT (new_values ->> column_name)::uuid
   FROM unnest(TG_ARGV) columns(column_name)
   WHERE new_values ->> column_name IS NOT NULL
     AND (TG_OP = 'INSERT' OR new_values ->> column_name IS DISTINCT FROM old_values ->> column_name)
   ORDER BY 1
 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || target_id::text, 0));
   IF EXISTS (
     SELECT 1 FROM app_private.account_deletion_operations operation
     WHERE operation.target_user_id = target_id
       AND (operation.phase IN ('external_pending', 'completed')
         OR (operation.phase = 'database_pending'
           AND operation.db_transaction_id IS DISTINCT FROM txid_current()))
   ) THEN
     RAISE EXCEPTION 'Cannot create a reference to an account being deleted.' USING ERRCODE = '42501';
   END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.guard_account_deletion_reference() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.guard_account_deletion_reference() TO service_role;

DO $$
DECLARE relation record;
BEGIN
 -- Statement guards also cover zero-row writes and client-invoked definers.
 FOR relation IN
   SELECT namespace.nspname, table_row.relname
   FROM pg_class table_row JOIN pg_namespace namespace ON namespace.oid = table_row.relnamespace
   WHERE table_row.relkind = 'r' AND namespace.nspname IN ('public', 'plugin_data')
   UNION ALL SELECT 'storage', 'objects'
 LOOP
   EXECUTE format('CREATE TRIGGER account_deletion_write_fence BEFORE INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION app_private.guard_account_deletion_write()',
     relation.nspname, relation.relname);
 END LOOP;
 -- Service jobs have no auth.uid. Fence new user references separately so an
 -- Auth cleanup retry cannot accumulate new dependencies after database commit.
 FOR relation IN
   SELECT namespace.nspname, table_row.relname,
     string_agg(DISTINCT quote_literal(attribute.attname), ',') AS arguments
   FROM pg_constraint constraint_row
   JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
   JOIN pg_namespace namespace ON namespace.oid = table_row.relnamespace
   JOIN pg_attribute attribute ON attribute.attrelid = table_row.oid
     AND attribute.attnum = constraint_row.conkey[1]
   WHERE constraint_row.contype = 'f'
     AND constraint_row.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
     AND cardinality(constraint_row.conkey) = 1
     AND namespace.nspname IN ('public', 'plugin_data', 'app_private', 'private')
     AND attribute.atttypid = 'uuid'::regtype
   GROUP BY namespace.nspname, table_row.relname
 LOOP
   EXECUTE format('CREATE TRIGGER account_deletion_reference_fence BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION app_private.guard_account_deletion_reference(%s)',
     relation.nspname, relation.relname, relation.arguments);
 END LOOP;
END;
$$;
COMMIT;
