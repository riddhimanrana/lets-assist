-- The shape and the reach of the detailed notice path. No fixtures, no sends.
--
-- Everything asserted here is a statement about the catalog: which functions
-- exist, who may execute them, which tables carry a notice trigger, and -- the
-- point of several of these -- which tables deliberately carry none.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(76);

-- ---------------------------------------------------------------------------
-- The functions exist with the reviewed signatures.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  to_regprocedure(signature) IS NOT NULL,
  format('%s is defined', signature)
)
FROM (VALUES
  ('plugin_data.csf_publication_profile_owner(uuid,uuid)'),
  ('plugin_data.csf_publication_personal_event_key(text)'),
  ('plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)'),
  ('plugin_data.csf_record_point_submission_notification()'),
  ('plugin_data.csf_record_profile_notification()'),
  ('plugin_data.csf_publication_notices_suppressed()'),
  ('plugin_data.csf_guard_personal_notice_campaign_scope()'),
  ('plugin_data.csf_create_personal_notice_campaign_draft(uuid,uuid,text,text,text,jsonb,text)'),
  ('plugin_data.csf_finalize_personal_notice_content(uuid,uuid)'),
  ('plugin_data.csf_verified_account_email(uuid)'),
  ('plugin_data.csf_suppress_publication_notices()')
) AS expected(signature);

-- ---------------------------------------------------------------------------
-- No browser role may execute any of them, old or new.
-- ---------------------------------------------------------------------------
-- A notice function decides who hears about a member's record. None of them is
-- a client-callable surface, so none is in the architecture allowlist, and this
-- is the assertion that keeps it that way.
SELECT extensions.ok(
  NOT has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE')
  AND NOT has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE'),
  format('%s is unreachable from a browser role', signature)
)
FROM (VALUES
  ('plugin_data.csf_publication_profile_owner(uuid,uuid)'),
  ('plugin_data.csf_publication_personal_event_key(text)'),
  ('plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)'),
  ('plugin_data.csf_record_point_submission_notification()'),
  ('plugin_data.csf_record_profile_notification()'),
  ('plugin_data.csf_publication_recipient_allowed(uuid,text,uuid,uuid)'),
  ('plugin_data.csf_record_publication_notifications()'),
  ('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)'),
  ('plugin_data.csf_publication_notices_suppressed()'),
  ('plugin_data.csf_guard_personal_notice_campaign_scope()'),
  ('plugin_data.csf_create_personal_notice_campaign_draft(uuid,uuid,text,text,text,jsonb,text)'),
  ('plugin_data.csf_finalize_personal_notice_content(uuid,uuid)'),
  ('plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)'),
  ('plugin_data.csf_verified_account_email(uuid)'),
  ('plugin_data.csf_suppress_publication_notices()')
) AS expected(signature);

-- Only the two the worker calls are reachable by the service role. A trigger
-- function or a recipient predicate reached from outside the database would be
-- a way to ask "who owns this record" without going through a delivery.
SELECT extensions.ok(
  NOT has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE'),
  format('%s is not reachable by the service role', signature)
)
FROM (VALUES
  ('plugin_data.csf_publication_profile_owner(uuid,uuid)'),
  ('plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)'),
  ('plugin_data.csf_publication_recipient_allowed(uuid,text,uuid,uuid)'),
  ('plugin_data.csf_publication_notices_suppressed()'),
  -- The pre-send re-check is the ledger's to call, never a caller's to skip.
  ('plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)'),
  -- Resolving somebody's confirmed address is not a question anything outside
  -- the database gets to ask.
  ('plugin_data.csf_verified_account_email(uuid)')
) AS expected(signature);

SELECT extensions.ok(
  has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE'),
  format('%s stays reachable by the worker', signature)
)
FROM (VALUES
  ('plugin_data.csf_claim_publication_notifications(integer)'),
  ('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)'),
  ('plugin_data.csf_finish_publication_notification(uuid,uuid,uuid,text)'),
  ('plugin_data.csf_create_personal_notice_campaign_draft(uuid,uuid,text,text,text,jsonb,text)'),
  ('plugin_data.csf_finalize_personal_notice_content(uuid,uuid)')
) AS expected(signature);

-- ---------------------------------------------------------------------------
-- Every one of them is a definer function with an empty search path.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  p.prosecdef AND p.proconfig @> ARRAY['search_path=""']::text[],
  format('%s is SECURITY DEFINER with an empty search_path', expected.signature)
)
FROM (VALUES
  ('plugin_data.csf_publication_profile_owner(uuid,uuid)'),
  ('plugin_data.csf_publication_personal_event_key(text)'),
  ('plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)'),
  ('plugin_data.csf_record_point_submission_notification()'),
  ('plugin_data.csf_record_profile_notification()')
) AS expected(signature)
JOIN pg_proc p ON p.oid = to_regprocedure(expected.signature);

-- ---------------------------------------------------------------------------
-- The notice triggers are on exactly the two personal tables.
-- ---------------------------------------------------------------------------
SELECT extensions.is(
  (SELECT count(*)::int FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgrelid = 'plugin_data.csf_point_submissions'::regclass
     AND t.tgfoid = to_regprocedure(
       'plugin_data.csf_record_point_submission_notification()')),
  1,
  'a point submission carries exactly one notice trigger'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgrelid = 'plugin_data.csf_profiles'::regclass
     AND t.tgfoid = to_regprocedure('plugin_data.csf_record_profile_notification()')),
  1,
  'a profile carries exactly one notice trigger'
);

-- A notice fires on a column list, not on every write. A trigger with no column
-- restriction would announce a normalization pass or an internal touch.
SELECT extensions.ok(
  (SELECT bool_and(octet_length(t.tgattr::text) > 0) FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgfoid IN (
       to_regprocedure('plugin_data.csf_record_point_submission_notification()'),
       to_regprocedure('plugin_data.csf_record_profile_notification()'))),
  'each notice trigger is restricted to named columns'
);

-- ---------------------------------------------------------------------------
-- NOTHING in the decision path announces anything.
-- ---------------------------------------------------------------------------
-- A staged decision is not a member-visible fact, and a decision release
-- reaches the member through the chapter's own publication, not through a
-- personal notice or an email from this queue. Neither has a trigger here, and
-- this is the assertion that will fail if one is ever added without a review.
SELECT extensions.is(
  (SELECT count(*)::int FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal
     AND t.tgfoid IN (
       to_regprocedure('plugin_data.csf_record_publication_notifications()'),
       to_regprocedure('plugin_data.csf_record_point_submission_notification()'),
       to_regprocedure('plugin_data.csf_record_profile_notification()'))
     AND c.relname NOT IN (
       'csf_announcements', 'csf_opportunities',
       'csf_point_submissions', 'csf_profiles')),
  0,
  'no notice trigger exists on any table other than the four reviewed ones'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal
     AND n.nspname = 'plugin_data'
     AND (c.relname LIKE '%decision%' OR c.relname LIKE '%application%')
     AND t.tgfoid IN (
       to_regprocedure('plugin_data.csf_record_publication_notifications()'),
       to_regprocedure('plugin_data.csf_record_point_submission_notification()'),
       to_regprocedure('plugin_data.csf_record_profile_notification()'),
       to_regprocedure(
         'plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)'))),
  0,
  'decision staging, sync and release announce nothing and mail nothing'
);

-- ---------------------------------------------------------------------------
-- The event table can describe a recurrence, and only for the personal kinds.
-- ---------------------------------------------------------------------------
SELECT extensions.has_column('plugin_data', 'csf_publication_events', 'event_key',
  'the event table carries a recurrence key');

SELECT extensions.col_not_null('plugin_data', 'csf_publication_events', 'event_key',
  'the recurrence key is never null');

SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_publication_events'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) =
        'UNIQUE (organization_id, source_kind, source_id, event_key)'),
  'the coordinate that must stay unique now includes the recurrence key'
);

SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_publication_events'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) =
        'UNIQUE (organization_id, source_kind, source_id)'),
  'the old once-per-object constraint is gone, so a re-review can be announced'
);

SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_publication_events'::regclass
      AND conname = 'csf_publication_events_recurrence_check'),
  'a chapter publication is still constrained to happen exactly once'
);

SELECT extensions.ok(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'plugin_data.csf_publication_events'::regclass
     AND conname = 'csf_publication_events_source_kind_check')
  LIKE '%point_submission%',
  'the event table admits the two personal kinds'
);

-- ---------------------------------------------------------------------------
-- The authorization contract publishes the new fields and no others.
-- ---------------------------------------------------------------------------
-- The body is read rather than called because calling it needs a live lease.
-- What matters is that it returns the chapter, the subject and the address, and
-- that it never selects a review note, a proof row or an awarded figure.
SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(
     to_regprocedure('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)')
   ), needle) > 0)
   FROM unnest(ARRAY['chapterName', 'authorizedSubject', 'recipientEmail']) AS needle),
  'authorization publishes the chapter name, the subject and the address'
);

SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(
     to_regprocedure('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)')
   ), needle) = 0)
   FROM unnest(ARRAY[
     'review_notes', 'awarded_points', 'claimed_points',
     'csf_submission_files', 'object_path', 'suggested_points'
   ]) AS needle),
  'authorization never reads a review note, a points figure or a proof object'
);

-- The description is the member's own free text and an officer may have
-- amended it, so the activity's published title is the only quotable subject.
SELECT extensions.ok(
  strpos(pg_get_functiondef(
    to_regprocedure('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)')
  ), 'submission.description') = 0,
  'a point-submission notice never quotes the submission description'
);

-- ---------------------------------------------------------------------------
-- Mail is the ledger's to send, and one notice can only open one campaign.
-- ---------------------------------------------------------------------------
SELECT extensions.has_column('plugin_data', 'csf_communication_campaigns',
  'source_publication_event_id',
  'a campaign can name the personal notice that originated it');

-- This index IS the de-duplication guarantee for a replayed hand-off. Without
-- it a recovered lease opens a second campaign and the member is mailed twice.
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'plugin_data.csf_communication_campaigns'::regclass
      AND i.indisunique
      AND strpos(pg_get_indexdef(i.indexrelid), 'source_publication_event_id') > 0
      AND strpos(pg_get_indexdef(i.indexrelid), 'WHERE') > 0),
  'at most one live campaign may exist per notice'
);

SELECT extensions.ok(
  strpos((SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'plugin_data.csf_communication_campaigns'::regclass
     AND conname = 'csf_communication_campaigns_one_source_check')
  , 'source_publication_event_id') > 0,
  'a campaign still has at most one source, now counting a notice'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgrelid = 'plugin_data.csf_communication_campaigns'::regclass
     AND t.tgfoid = to_regprocedure(
       'plugin_data.csf_guard_personal_notice_campaign_scope()')),
  1,
  'a notice campaign is guarded into being transactional and audience-free'
);

-- The actorless finalization must be reachable ONLY for a notice campaign, or
-- it becomes a way to finalize a broadcast with nobody accountable for it.
SELECT extensions.ok(
  strpos(pg_get_functiondef(
    to_regprocedure('plugin_data.csf_finalize_personal_notice_content(uuid,uuid)')
  ), 'source_publication_event_id IS NULL') > 0,
  'notice finalization refuses any campaign that is not a notice'
);

-- ---------------------------------------------------------------------------
-- The immediately-before-send re-check.
-- ---------------------------------------------------------------------------
-- A lease can last 1800 seconds, so consent at queue time proves nothing about
-- consent at send time. These are the four things re-read inside the gate.
SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(
     to_regprocedure('plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)')
   ), needle) > 0)
   FROM unnest(ARRAY[
     'source_publication_event_id',
     'csf_publication_recipient_allowed',
     'email_notifications=false OR organization_updates=false',
     'normalized_recipient_email'
   ]) AS needle),
  'a notice re-checks recipient, both opt-outs, and the frozen address before sending'
);

-- ---------------------------------------------------------------------------
-- A backfill announces nothing.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  strpos(pg_get_functiondef(
    to_regprocedure(
      'plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)')
  ), 'csf_publication_notices_suppressed()') > 0,
  'a suppressed bulk import records no notice at all'
);

-- Not recorded, rather than recorded and filtered later: there must be no row
-- for a later change of mind to release into a mail storm.
SELECT extensions.ok(
  position('csf_publication_notices_suppressed()' in pg_get_functiondef(
    to_regprocedure(
      'plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)')))
  < position('INSERT INTO plugin_data.csf_publication_events' in pg_get_functiondef(
    to_regprocedure(
      'plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)'))),
  'the suppression check runs before any event row is written'
);

-- ---------------------------------------------------------------------------
-- The destinations are the tabs that actually render each object.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(
     to_regprocedure('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)')
   ), needle) > 0)
   FROM unnest(ARRAY[
     'csf-activities', 'csf-submissions', 'csf-profile', 'csf_service=opportunities'
   ]) AS needle),
  'each notice opens the tab that renders its object'
);

-- csf_profile selects a row in the staff member directory. A member's own
-- notice must not carry it: it would not open, and it reads like a link to
-- somebody's record.
--
-- Matched literally. LIKE would read the underscore as a single-character
-- wildcard, so a pattern naming csf_profile also matches the csf-profile tab
-- this notice is supposed to open.
SELECT extensions.ok(
  strpos(pg_get_functiondef(
    to_regprocedure('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)')
  ), '''csf_profile''') = 0,
  'a profile notice opens My CSF and carries no directory selector'
);

-- ---------------------------------------------------------------------------
-- A profile notice fires on member-visible identity fields, and only those.
-- ---------------------------------------------------------------------------
-- The exact column list is pinned because this is where a private note, an
-- internal flag, or a decision column would be announced if one were ever
-- added to the trigger. Officer notes live in their own table and are not
-- reachable from here at all; this keeps it that way by construction.
SELECT extensions.set_eq(
  $$SELECT a.attname::text
    FROM pg_trigger t
    JOIN pg_attribute a
      ON a.attrelid = t.tgrelid
     AND a.attnum = ANY (string_to_array(t.tgattr::text, ' ')::int2[])
    WHERE NOT t.tgisinternal
      AND t.tgfoid = to_regprocedure('plugin_data.csf_record_profile_notification()')$$,
  ARRAY['first_name','middle_name','last_name','preferred_name',
        'nicknames','school_email','personal_email'],
  'a profile notice watches exactly the member-visible identity fields'
);

-- A submission notice fires on the outcome, never on a note being edited in
-- place, which is how an officer's private wording would otherwise reach a
-- member as "your submission was updated".
SELECT extensions.set_eq(
  $$SELECT a.attname::text
    FROM pg_trigger t
    JOIN pg_attribute a
      ON a.attrelid = t.tgrelid
     AND a.attnum = ANY (string_to_array(t.tgattr::text, ' ')::int2[])
    WHERE NOT t.tgisinternal
      AND t.tgfoid = to_regprocedure(
        'plugin_data.csf_record_point_submission_notification()')$$,
  ARRAY['status'],
  'a point-submission notice watches only the outcome column'
);

-- ---------------------------------------------------------------------------
-- Mail goes to a confirmed authentication address, never to the mirror.
-- ---------------------------------------------------------------------------
-- public.profiles.email can lag a change of address and is no evidence the
-- address was ever confirmed. Both the enqueue-time read and the pre-send
-- re-check must resolve through the authentication record instead.
SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(
     to_regprocedure('plugin_data.csf_verified_account_email(uuid)')
   ), needle) > 0)
   FROM unnest(ARRAY['auth.users', 'email_confirmed_at']) AS needle),
  'the address resolver requires a confirmed authentication address'
);

SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(to_regprocedure(signature)),
     'csf_verified_account_email') > 0)
   FROM (VALUES
     ('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)'),
     ('plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)')
   ) AS checked(signature)),
  'both the enqueue read and the pre-send re-check use the confirmed address'
);

-- Neither may reach past the resolver to the mirror. The resolver is the one
-- place that decides what counts as an address, so a direct read of
-- public.profiles.email in either of these is the whole defect returning.
SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(to_regprocedure(signature)),
     'FROM public.profiles') = 0)
   FROM (VALUES
     ('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)'),
     ('plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)')
   ) AS checked(signature)),
  'neither function reads the profiles mirror for an address'
);

-- ---------------------------------------------------------------------------
-- A withdrawn notice stays withdrawn.
-- ---------------------------------------------------------------------------
-- The partial unique index ignores cancelled rows so an operator can withdraw
-- a campaign. The draft RPC must therefore NOT reuse that predicate when it
-- looks for an existing campaign: doing so would let an automatic replay walk
-- past a cancelled campaign and open a fresh one, sending the message the
-- operator just stopped.
SELECT extensions.ok(
  strpos(pg_get_functiondef(to_regprocedure(
    'plugin_data.csf_create_personal_notice_campaign_draft(uuid,uuid,text,text,text,jsonb,text)')
  ), 'status <> ''cancelled''') = 0,
  'the notice draft lookup does not skip cancelled campaigns'
);

SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(to_regprocedure(
     'plugin_data.csf_create_personal_notice_campaign_draft(uuid,uuid,text,text,text,jsonb,text)')
   ), needle) > 0)
   FROM unnest(ARRAY['''held''', '''cancelled''', 'review_blocked_at']) AS needle),
  'a cancelled or review-blocked notice is reported held rather than recreated'
);

-- ---------------------------------------------------------------------------
-- A bulk lane can switch notices off, and only for its own transaction.
-- ---------------------------------------------------------------------------
-- Transaction-local on purpose. A setting that could be turned on once and left
-- on would silently stop notices for everybody.
SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(
     to_regprocedure('plugin_data.csf_suppress_publication_notices()')
   ), needle) > 0)
   FROM unnest(ARRAY['set_config', 'app.csf_suppress_notices', 'true']) AS needle),
  'the suppression entry point is transaction-local'
);

SELECT extensions.ok(
  has_function_privilege('service_role',
    to_regprocedure('plugin_data.csf_suppress_publication_notices()'), 'EXECUTE'),
  'a bulk lane can reach the suppression entry point'
);

-- ---------------------------------------------------------------------------
-- A profile notice keeps the chapter's own audience restriction.
-- ---------------------------------------------------------------------------
-- Current-term membership is the same restriction chapter mail already uses.
-- It also bounds a historical correction: reconciling records for members who
-- have since left announces nothing, because they are no longer an audience.
SELECT extensions.ok(
  (SELECT bool_and(strpos(pg_get_functiondef(
     to_regprocedure('plugin_data.csf_publication_recipient_allowed(uuid,text,uuid,uuid)')
   ), needle) > 0)
   FROM unnest(ARRAY['csf_term_memberships', 'term.is_current']) AS needle),
  'a profile notice requires current-term membership'
);

SELECT extensions.finish();
ROLLBACK;
