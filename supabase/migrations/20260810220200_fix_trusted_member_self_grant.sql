-- Close a privilege escalation on public.trusted_member (AUD-001).
--
-- The INSERT policy accepted any `status` from the row owner while the sibling
-- UPDATE policy required `status IS NULL`. trg_tm_sync_profiles is
-- AFTER INSERT OR UPDATE OF status and calls sync_profiles_trusted_from_tm(),
-- which sets app.allow_trusted_sync and writes profiles.trusted_member,
-- deliberately bypassing prevent_trusted_member_edit(). An applicant could
-- therefore insert their own row with status = true and self-approve,
-- unlocking organization creation and project creation.
--
-- Two independent guards are added. They fail differently: the policy is
-- catalog state that a future CREATE POLICY could overwrite, and the trigger is
-- code that a future CREATE OR REPLACE could overwrite. Either alone closes the
-- hole, so a single regression is not exploitable.
--
-- Both statements are idempotent so this migration re-applies as a no-op if the
-- policy is ever repaired out-of-band ahead of the ledger.

BEGIN;

-- Guard 1: mirror the UPDATE policy's status predicate.
DROP POLICY IF EXISTS "trusted_member_insert_authenticated" ON public.trusted_member;

CREATE POLICY "trusted_member_insert_authenticated"
  ON public.trusted_member
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (
      (SELECT auth.uid()) = user_id
      AND status IS NULL
    )
  );

-- Guard 2: the BEFORE INSERT trigger already owns identity binding, so it also
-- owns approval-state binding. Extending it avoids a second BEFORE trigger,
-- whose firing order would depend on its name.
--
-- Raising rather than coercing is deliberate. RLS WITH CHECK is evaluated on
-- the post-BEFORE-trigger row, so silently setting status := NULL would make
-- the policy pass and hide every attempt. The legitimate application path
-- (app/trusted-member/actions.ts) sends status = null, so raising costs it
-- nothing and makes an attempt visible in the Postgres log.
CREATE OR REPLACE FUNCTION public.trusted_member_set_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
begin
  if auth.role() = 'service_role' then
    if new.user_id is null then
      raise exception 'Authentication required';
    end if;
    if new.id is null then
      new.id := new.user_id;
    end if;
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  new.user_id := auth.uid();
  if new.id is null then
    new.id := auth.uid();
  end if;

  if new.status is not null and not public.is_super_admin() then
    raise exception 'trusted member approval state is server-managed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- CREATE OR REPLACE preserves the existing ACL, but the schema-level
-- ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon, authenticated in
-- the baseline makes this cheap insurance.
REVOKE EXECUTE ON FUNCTION public.trusted_member_set_user_id()
  FROM PUBLIC, anon, authenticated;

COMMIT;
