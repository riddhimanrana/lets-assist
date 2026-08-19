-- Close browser-direct verified-certificate forgery on public.certificates.
--
-- The baseline INSERT/UPDATE/DELETE policies all carried the same disjunction:
--
--     is_super_admin()
--     OR EXISTS (signup -> project WHERE project.creator_id = auth.uid())
--     OR (type = 'verified'      AND auth.uid() = creator_id)
--     OR (type = 'self-reported' AND auth.uid() = user_id)
--
-- The third branch is self-satisfying. `type` and `creator_id` are both
-- attacker-supplied columns on the row being written, so ANY authenticated
-- holder of the public anon key could POST a row with type='verified' and
-- creator_id set to their own uid and receive a platform-issued "verified"
-- certificate, complete with an arbitrary project_title, organization_name,
-- creator_name, hour range, and (until this migration) is_certified=true.
-- Those rows render through the same trusted certificate UI and the same
-- /certificates/<id> verification route as certificates that were actually
-- earned, and they aggregate into the volunteer's public hour totals.
--
-- 20260811081506 then added
--
--     CREATE UNIQUE INDEX certificates_verified_signup_unique
--       ON public.certificates (signup_id)
--       WHERE type = 'verified' AND signup_id IS NOT NULL;
--
-- which turned the forgery into an availability attack on other people's
-- projects. Nothing in the policy constrained signup_id, so an attacker could
-- plant a forged verified row against a VICTIM's signup id in a project they
-- have nothing to do with. publish_volunteer_hours_transactional then fails
-- that session forever with 23505 'an existing verified certificate conflicts
-- with the requested hours' (or trips the unique index), and organizers have
-- no browser path to delete the squatting row. One anonymous-key request could
-- permanently block a project's hour publication.
--
-- The second branch -- project creators writing certificates straight from the
-- browser -- has no remaining consumer either. Every legitimate write path was
-- inventoried:
--
--   * app/api/self-reported-hours/route.ts        session client, INSERT,
--                                                 type='self-reported', own uid
--   * app/api/self-reported-hours/[id]/route.ts   session client, DELETE, own
--                                                 self-reported row
--   * app/projects/[id]/hours/actions.ts          publish_volunteer_hours_
--                                                 transactional (SECURITY
--                                                 DEFINER, org-scoped, atomic)
--   * app/api/cron/auto-publish-hours/route.ts    service role
--   * app/anonymous/[id]/actions.ts               service role (claim transfer)
--   * archive_anonymous_signups_for_cleanup       SECURITY DEFINER, service
--                                                 role EXECUTE only
--
-- Verified certificates are therefore issued exclusively by SECURITY DEFINER
-- code that re-derives identity, re-checks organization-scoped authority
-- (project creator, org admin, or staff on a staff-manageable project), and
-- writes the whole publication in one transaction. RLS bypasses that code
-- path entirely, so removing the organizer and verified branches from these
-- policies takes nothing away from organizers: it removes only the
-- browser-direct forgery door beside the canonical one.
--
-- publish_volunteer_hours_transactional keeps its `authenticated` EXECUTE
-- grant. That grant is the intended organizer entry point and is deliberately
-- untouched, as are the SELECT policy and every SECURITY DEFINER ACL.
--
-- What authenticated clients keep: their own self-reported hours, pinned on
-- both sides of every write so ownership and trust markers are immutable.
-- USING sees the OLD row and WITH CHECK sees the NEW row, so an UPDATE must
-- satisfy the predicate before and after. That makes type promotion
-- ('self-reported' -> 'verified'), ownership transfer, self-certification
-- (is_certified), and late attachment to a project_id/signup_id all
-- unreachable, rather than only blocking them at INSERT time.

BEGIN;

DROP POLICY IF EXISTS "certificates_insert_authenticated" ON public.certificates;
DROP POLICY IF EXISTS "certificates_update_authenticated" ON public.certificates;
DROP POLICY IF EXISTS "certificates_delete_authenticated" ON public.certificates;

-- Self-reported hours only: the volunteer is simultaneously the subject and
-- the author, the row is detached from any project or signup, and it can claim
-- neither platform certification nor a stronger check-in method than
-- self-reporting.
CREATE POLICY "certificates_insert_authenticated"
  ON public.certificates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (
      certificates.type = 'self-reported'
      AND certificates.user_id = (SELECT auth.uid())
      AND certificates.creator_id = (SELECT auth.uid())
      AND certificates.project_id IS NULL
      AND certificates.signup_id IS NULL
      AND certificates.is_certified IS FALSE
      AND certificates.check_in_method = 'self_report'
    )
  );

-- USING inspects the OLD row and WITH CHECK the NEW one, so both sides must
-- hold. type promotion, ownership transfer, self-certification, and late
-- attachment to a project or signup are therefore unreachable in either
-- direction: an attacker can neither edit into a row they do not own nor edit
-- a row they do own out of the self-reported envelope. check_in_method is
-- pinned on the NEW row only, so a legacy self-reported row can be corrected
-- into the envelope but never out of it.
CREATE POLICY "certificates_update_authenticated"
  ON public.certificates
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      certificates.type = 'self-reported'
      AND certificates.user_id = (SELECT auth.uid())
      AND certificates.creator_id = (SELECT auth.uid())
      AND certificates.project_id IS NULL
      AND certificates.signup_id IS NULL
      AND certificates.is_certified IS FALSE
    )
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (
      certificates.type = 'self-reported'
      AND certificates.user_id = (SELECT auth.uid())
      AND certificates.creator_id = (SELECT auth.uid())
      AND certificates.project_id IS NULL
      AND certificates.signup_id IS NULL
      AND certificates.is_certified IS FALSE
      AND certificates.check_in_method = 'self_report'
    )
  );

-- DELETE keeps exactly the baseline self-reported branch and nothing else.
-- Removing a row you authored about yourself forges nothing, so this stays
-- deliberately looser than INSERT/UPDATE: pinning creator_id or
-- check_in_method here would only strand legacy self-reported rows whose
-- owners can currently delete them, which is the contract
-- app/api/self-reported-hours/[id]/route.ts already enforces (own user_id,
-- type = 'self-reported'). The removed branches are the verified and
-- project-creator ones -- the pair that let an attacker delete OTHER people's
-- certificates, and that let a squatter clean up after a forgery.
CREATE POLICY "certificates_delete_authenticated"
  ON public.certificates
  FOR DELETE
  TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      certificates.type = 'self-reported'
      AND certificates.user_id = (SELECT auth.uid())
    )
  );

-- Defence in depth beside the policies above.
--
-- TRUNCATE is the load-bearing one: row-level security does not apply to
-- TRUNCATE at all, so the baseline's blanket
--   GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ... TO
--   anon, authenticated
-- left every certificate in the table one statement away from any caller that
-- can reach SQL as `authenticated` or `anon`, no matter how tight the policies
-- are. `anon` additionally has no legitimate write on this table -- anonymous
-- volunteers get certificates written for them by service-role code -- so its
-- write privileges go entirely, and a future permissive anon policy cannot
-- reopen this on its own. SELECT grants are left exactly as they are; reads
-- stay governed by certificates_select_authenticated_owner_or_organizer.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.certificates FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.certificates FROM authenticated;

COMMENT ON TABLE public.certificates IS
  'Volunteer hour certificates. Verified certificates are issued only by SECURITY DEFINER publication code (publish_volunteer_hours_transactional, issue_supplemental_verified_certificates) or the service role; authenticated clients may write only their own detached, uncertified self-reported rows.';

COMMIT;
