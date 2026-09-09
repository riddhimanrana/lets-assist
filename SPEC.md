§G

DVHS CSF officer UX → class-first Home → Classes → Applications → More; class workspace → Stream → Members → Activities → Submissions.

§C

- Root `72b69030` contains the invitation repair. Its full quality job passes.
  Browser assertions confirmed wrong-account refusal and recipient staff
  acceptance, but fixture cleanup failed when deleting the organization before
  its memberships. The test now removes scoped memberships first. A rolled-back
  Development database check proves that cleanup order. Hosted acceptance is
  still required for the grouped release.
  Read-only Production comparison confirms exact saved labels and points for
  all 4,434 imported activity entries and labels for 1,392 attendance records.
  Their source rows exist. Fresh Drive checks, applications, and live workflows
  remain unfinished. The signed-in Production Google connection recheck passes,
  and the Class of 2027 workbook revision check reports up to date.
- Root CI `34298362402` passed quality and database checks but its invitation
  browser test still failed before sign-in; 88 other browser tests passed.
  The token-scoped lookup unnecessarily joined the private inviter profile,
  which anonymous users cannot read. The local fix removes that join without
  changing grants and identifies the inviting organization in the UI. The
  recipient and wrong-account journey must pass before the grouped release.
- Production chapter staff invitations omit the token header required by their
  existing database read policy. The inviting administrator can open the link,
  but the invited account cannot. The local repair keeps the token on the
  request-scoped client for lookup and acceptance, retains invited-email
  enforcement, and adds isolated recipient and wrong-account browser checks.
  The chapter account's invitation remains pending until live acceptance.
- Development app `7ba7f075` passed source and database CI. Hosted run
  `34288632216` tested it using identical application bytes at tooling revision
  `3b79895a`. Its 9,405 requests had zero errors, but officer route budgets
  failed: Classes p95 2.60 seconds, Applications 3.03, and Home 3.02. Mutation
  p95 was 1.34 seconds; all 25 review navigations passed without a crash.
  Production promotion remains gated. The current follow-up fixes hidden Sheet
  update buttons, removes unused import row payloads, reduces new row batches
  to five, and starts independent Home reads together. These changes still
  require hosted proof. Original import and acceptance failures remain saved.
- Source-authorized new-applicant creation is implemented locally through the
  existing audited profile and row-reconciliation transactions. Calls create up
  to 50 unclaimed profiles, keep form emails unverified, and make no application
  decision or semester membership. Existing identities and conflicting contact
  evidence stay in review. The worker prepares profiles before freezing its
  commit scope, with bounded work and durable retry receipts. Rollback-only
  database tests pass for single-row and 51-applicant cases. Production and the
  complete import/release acceptance remain unfinished.
- Application repeat sync now preserves a successful same-file profile connection
  through unchanged receipts, with exact semester/class and identity-evidence
  checks. It does not treat form email as verified account identity. Provider-file
  changes invalidate retry scope; target changes prevent an unchanged-row skip.
  Forty-six focused checks pass. New-profile automation and live Production
  reconciliation remain unfinished. No deployment or Production mutation ran.
- Local automatic application updates now run through the existing authenticated
  workbook route and disable switch. Officers can enable or pause them in the
  Sheet dialog after reviewing a sealed mapping. Unknown saves require a saved
  state check before retry; stale responses cannot change the current selection.
  Thirty-two focused tests, TypeScript, zero-warning lint, and all 290 private
  plugin test files pass. Historical applications across all available chapter
  sources, including alumni, still require Production reconciliation. No local
  result establishes that those applications are imported. Automatic new
  identities, class-workbook integration, full replay, and release remain open.
- Root CI `34189124828` passed on `1b530a27` with private `fd9f837`:
  quality, database replay, 87 CSF browser passes, and three DV browser passes.
  Four CSF skips remain, and Communications navigation passed only on retry.
  Its retained screenshot shows the officer tour covering the menu; the local
  test correction explicitly dismisses the tour before navigation.
  Private PR #268 adds pre-acquisition saved-tab validation for preview retries
  at `e92f59b`. Sixteen focused tests, TypeScript, zero-warning lint, and all
  278 private test files pass. Private CI `34190350981` passed and PR #268
  merged at `b2b9339`, with the tested tree unchanged. The combined local run
  passes 306 root and 307 plugin test files with this pin. Strict gitlink and
  operator documentation checks pass. Root CI integration is pending.
  The grouped dialog release still requires hosted acceptance.
  Production still has 460 migrations,
  four linked workbooks, 1,047 profile records, and zero applications in the
  latest count-only check. No Production mutation or app deployment occurred.
- Private PR #267 passed CI `34187091711` and merged at `fd9f837`.
  The complete private suite passes across 277 files. Its previous failure was
  the old expanded-row layout contract, updated to cover the requested first-row
  disclosure while retaining evidence and action checks. The Development-only
  source allowlist now contains the nine verified fictional sources and all
  twelve previous entries. The saved setting was verified without a deployment.
  Docker Desktop cannot start the local browser stack. CI supplied the isolated
  browser proof above. Hosted UI acceptance remains pending for the new dialog.
- The application Sheet UI now uses a chapter-wide dialog locally. It removes
  the technical stepper, folds column matches and source evidence away, and
  opens the first unresolved application for review. Google Picker temporarily
  releases the dialog's focus trap. The review-page semester no longer supplies
  a source default. The Sheet supplies it, or the officer selects it explicitly.
  Forty-five focused checks, TypeScript, and zero-warning lint pass. Browser
  acceptance, publication, and Production reconciliation remain open.
- Private PR #266 groups import feedback, selected-tab analysis, List I aliases,
  and removal of the fixed Class of 2030 history ban at `35b1df6`. Empty tabs
  still produce templates with no parsed rows. Populated sources retain term,
  source, identity, and officer-commit checks. The full private suite passed
  before the final year-ban removal; its 20 focused checks, TypeScript, and
  zero-warning lint pass. PR #266 merged at `6fb9238`. The integrated root run
  reached 1,329 passes and one stale runbook-gitlink failure. The corrected
  runbook passes all 13 focused documentation checks. The full grouped suite
  still requires a passing run after the new application dialog change.
- The grouped private follow-up fixes preview wording after officer decisions
  and exposes the existing lineage-bound recheck beside unresolved rows.
  The regression first failed on both stale status cases. All 104 focused
  presentation, action-feedback, and import-readiness checks now pass, as do
  TypeScript and zero-warning lint. These changes are local, not deployed.
- Development migration 462 is applied and its requirement-evidence function
  body and service-only grants match the accepted catalog. PR #493 passed CI
  `34181764735` and merged at `36c3b74a` without an application build.
  Workbook check `34183419825` passed against deployed `8a48f7a1`: version 11
  completed once with four prepared tabs, four templates, and zero blocked tabs.
  The stale version-10 job retains its failure history and is blocked.
  All Development workers are disabled at revision 4. Review, commit, and
  duplicate-free repeat sync remain open. Production is unchanged.
- Development `8a48f7a1` includes the calculated-status parser fix, private
  `7daadc1`, and passed root CI `34176893568`. Live workbook rebuild
  `34178593288` failed because the append RPC rejects requirement evidence.
  Forward migration `20260908020559` extends that closed evidence contract
  with bounded origin, coordinate, value, and purpose fields included in the
  evidence digest. Legacy digests and approval payloads remain unchanged.
  The real append-RPC suite now has 30 assertions. CI `34179939118` passed
  the complete database and browser job on `f08dbf9a`; its quality job failed
  the release checks corrected in `9699f756`. The full local test run now
  passes across 305 root and 302 plugin test files. CI `34181210176` is running
  on that correction. Local Docker cannot start. All Development
  workers are disabled at revision 2 for this release. Production is unchanged.
- Hosted acceptance `34178004263` passed on `8a48f7a1`: 100 distinct fictional
  sessions, 9,775 requests, zero errors, read p95 1.437 seconds and p99 2.186
  seconds. Classes p95 is 1.627 seconds; Applications p95 is 2.146 seconds.
  Mutation p95 is 1.863 seconds. LCP p75 is 1.532 seconds, INP p75 is 32 ms,
  CLS p75 is 0.000816, all 25 review navigations completed without crashes,
  and retained heap fell 11.67%. This does not close the failed workbook path
  or prove the unapplied migration in hosted Development.
- Hosted Development acceptance `34171163941` passed on `e8e4c63b` with
  private pin `ef8cce1`: 100 distinct fictional sessions, 9,737 requests,
  zero errors, read p95 1.341 seconds, mutation p95 1.837 seconds.
  Officer Classes p95 is 1.577 seconds and Applications p95 is 1.904 seconds.
  LCP p75 is 1.400 seconds, INP p75 32 ms, CLS p75 0.000816,
  25 review navigations completed without crashes, and retained heap fell 11.01%.
  The earlier failed measurements remain below as historical evidence.
  Configuration-only Development redeployment `dpl_AeV3QCXGTexX5oupuYBMFPHuKSAF`
  serves the same accepted SHA with the replacement worker credentials.
  Disabled-worker authentication passed in run `34174136150`. Preparation run
  `34174172884` returned 503 after claiming the fictional workbook once. Its
  version-9 receipt later settled as blocked/stale_workbook_generation after
  an app recheck found version 10. Seven audited semester repairs completed the
  fictional class setup. Run `34174922514` then passed preparation of all four
  populated tabs and four empty templates on version 10, one attempt, no blocked
  tabs. All workers are disabled at revision 4. Row review exposed calculated
  All Reqs Met cells blocking otherwise populated rows. The local fix accepts
  recognized markers only in a separate class-history field, preserves formula
  provenance, and keeps identity, meeting, and application formulas blocked.
  All 273 private test files, TypeScript, and zero-warning lint pass.
  Private PR #265 passed CI `34176034001` and merged at `7daadc1`.
  Hosted formula verification, commit/repeat, official application
  reconciliation, and Production remain open.
- Private PR #263 passed CI and merged at `8e443de`, with the same tree as
  `c0fe247`. The full local run passed 86 cases and exposed two profile-history
  test failures. Explicit semester selection fixed the starting-state
  assumption; a separate lost early tab click required a client-readiness
  guard, now committed locally at `234b7f0`. The delayed-script desktop/mobile
  history rerun passes, as do ten profile tests and all 272 private test files.
  Root integration, the missing workbook journey, hosted acceptance, and
  Production data reconciliation remain open. No hosted deployment occurred.
- The full local browser run found a pre-hydration member-search failure.
  Search now waits for its client handlers before accepting input. The focused
  compiled rerun passes all six identity cases, including delayed JavaScript
  and a record beyond the first directory page. The original 83-pass,
  one-failure full run remains recorded. Full and hosted acceptance remain open.
- The local review loader now starts application/point rosters alongside
  independent review settings after authorization. Two regressions failed
  before the change; all five read-scope tests pass afterward. A fresh isolated
  database applied 461 migrations. Seventeen compiled browser journeys,
  database workflows, and 46 application/scheduling pgTAP assertions pass.
  Navigation stream errors and a shutdown permission diagnostic remain to be
  explained. No app process remained after the run. Hosted latency and the
  full acceptance workflow remain open.
- Local communications display now distinguishes a historical hold from an
  outstanding review. Cancelled/completed campaigns with zero unresolved
  receipts show their terminal state; unresolved receipts remain visible for
  every status. Five rendered failures pass after the fix. Sender authority,
  historical receipts, and unknown-outcome retry rules are unchanged. All 271
  private-plugin test files, all 304 root unit test files, TypeScript, and
  zero-warning lint pass.
- The supplied Fall 2026 application export was checked locally through the
  actual header analyzer and parser: 120 populated responses, 12 blank rows,
  classes 2027/2028/2029/2030 with 27/33/41/19 rows, and 120 transcript/receipt
  references. The local parser now omits explicit empty course answers while
  preserving raw evidence and paired-grade positions. This removes 59 false
  course entries and exposes 16 responses with missing course data for review.
  Fictional layout regressions, existing normalization tests, TypeScript, and
  zero-warning lint pass. No official application was imported or approved.
- Production workbook recheck on 2026-09-07 completed through the Riddhiman
  officer session. Classes 2027 and 2028 were unchanged. New provider revisions
  for 2029 and 2030 prepared successfully; 2030 retained eight empty templates.
  Officer batch approval committed the two 2029 previews, with 150 existing
  profile targets and no count increase in profiles, credits, opportunities,
  meetings, attendance, or memberships. The subsequent 2029 check returned
  unchanged. All four workbook registries have current prepared revisions.
  Applications remain incomplete: the canonical Spring/Fall previews contain
  588 rows, one resolved and 587 pending review, with zero imported applications.
  Production ignores the saved Spring preview URL and displays Fall instead;
  the saved-preview fix is in Development and still awaits grouped promotion.
- Classes no longer computes the Terms-only closure readiness preflight in the
  local follow-up. The caller regression failed before the change and passes
  with authorized Terms behavior preserved. Development still serves `7c24b7a3`.
  A new bounded fictional route diagnostic reproduces burst latency without
  rebuilding; neither its warm passing run nor this local fix closes hosted
  performance acceptance. Applications remains under diagnosis.
- Development email proof passed on `7c24b7a3`: no-send check `34158729752`,
  single ten-recipient dispatch `34158935320`, ten distinct delivered provider
  messages, ten matching sent events, and ten matching delivered events. The
  audited campaign is completed with no duplicate attempts. Prior refused
  attempts remain as attributed staff failures in a cancelled campaign. Runtime
  revision 6 leaves every worker disabled. Production proof remains open.
- Development follow-up `7c24b7a3` is deployed with private `70f2801` after CI
  `34093192415` passed. No-send worker proof `34095049908` passed. Hosted
  performance run `34094827987` failed: officer Classes p95 5.355 seconds,
  p99 6.225 seconds; Applications p95 2.776 seconds. Production email settlement,
  official application reconciliation, and Production promotion remain open. Production still has
  zero imported applications; linked workbooks and historical participation
  counts do not establish completion. Keep this continuation record local
  until final acceptance evidence is grouped, with no documentation-only build.
- Read acceptance applies to each member/officer route, not only the pooled
  request distribution. Every expected route needs measured requests, p95 at
  most 2.5 seconds, and p99 at most 5 seconds. Missing or duplicate route
  summaries fail acceptance. Run `34085356037` reported success under the old
  pooled gate, but officer Classes p95 was 3.835 seconds and Applications was
  2.566 seconds. These remain open performance defects. Local gate coverage
  prevents pooled member traffic from hiding either failure.
- Scheduled publishing is retired. Existing scheduled posts return to drafts
  with an audit receipt; IDs, content, attachments, and prior receipts survive.
  New scheduling requests are rejected before writing. Legacy publisher calls
  return zero work, and runtime controls cannot reactivate publication.
  Manual publishing and its separately queued email remain supported.
- Scheduling retirement is deployed to Development `54c95cf6`, not Production.
  Development has 461 migrations, one audited draft conversion, and no scheduled
  posts. Hosted run `34077477140` failed: read p95 3.157 seconds, read p99
  8.193 seconds, mutation p95 4.830 seconds. Browser vitals, 25 review
  navigations, and retained heap passed. Keep this failure and the existing
  thresholds. Local count-only route diagnostics pass ten tests, TypeScript,
  and targeted lint; they are not a latency fix or hosted acceptance.
  Ten-recipient audited campaign preparation is complete, but dispatch and
  current webhook settlement remain unproven. Production promotion stays open.
- The user approved one additional grouped Development deployment and a
  Development-only communications worker credential rotation. Vercel's
  branch-scoped sensitive variable and GitHub's Development secret are updated.
  The existing deployment does not yet prove the replacement credential works.
  Private PR #261 groups saved-preview selection and point-lock refusal fixes.
- Isolated officer connection approval passed after hydration/tour test setup
  was corrected. The attachment journey remains open: an existing fictional
  verification period correctly blocked submission, but the app mislabeled
  that known refusal as an unknown outcome. A local private error-classifier
  correction passes seven focused tests; it is not deployed. Keep the database
  submission freeze and retry protections intact.
- Later isolated acceptance closed the fictional verification period through
  the officer UI and passed PNG proof upload, fixed-point submission, and
  audited withdrawal. Beyond-first-page directory search passed with 52 owned
  fictional profiles and survived reload. All 266 private test files passed.
  These are local results, not a replacement for hosted latency or email proof.
- Release evidence, 2026-09-06: PR #483 merged accepted Development `b5edca71`
  to Production `82ab06b6` with identical tree and private gitlink `e03130c`.
  Hosted acceptance `34024436926` retains the failed 2.568-second LCP attempt
  and the passing unchanged-deployment retest with 9,619 requests and zero errors.
  Migration run `34058023928` verified the exact 460-migration catalog.
  App run `34058086857` used one Production build and verified the public alias.
  Workbook refresh transition `34058344966` passed without rebuilding.
  Official import reconciliation, current email settlement, and final live
  workflow/media acceptance remain open. Release success does not close them.

- Workbook preparation must retain the immediate source-scoped preview as retry
  lineage after a confirmed failure. Unknown and in-flight attempts block
  preparation. A rebuilt preview still requires an officer commit; preparation
  must not overwrite an earlier receipt or repeat a row write.
- Class Settings must use authoritative database identity blockers for both
  readiness counts and review rows. A valid workbook key does not clear a
  conflicting prior profile match. Pending identity blockers must expose the
  existing audited match/create/skip controls without changing source evidence.
- Preview generation must not send activity text, Sheet notes, or comments to
  a model, and must not automatically decide annotation-based requirements.
  Explicit officer notes reviews use a closed outcome vocabulary, a required
  reason, fresh class-import authority, and an atomic request receipt. A retry
  reuses that receipt; a changed decision cannot reuse its request identifier.
  Reviewing notes neither commits the preview nor clears unrelated import errors.
  Retired interpretation actions fail closed for old clients. Officer review
  must preserve source evidence and record an explicit decision and reason.

- Missing Vercel alias-operation metadata is not a promotion failure by itself.
  Require two exact READY Production-alias observations before treating it as
  settled. Never rebuild to recover an operation-status verification failure.

- Release catalog validation follows the versioned claim wrapper and its renamed
  legacy helper. It pins the accepted upgraded function definitions and explicit
  grants; it must not force a name-confirmed claim to report email verification.
  The provenance trigger must be attached to audit inserts, enabled for normal
  writes, and call the accepted function. Missing or repeated final SQL gate
  anchors stop verification before a provider request.
  Pin the complete accepted migration sequence, including its length and hash,
  so inserted, replaced, omitted, or reordered versions require release review.
  The legacy path also requires its exact accepted ledger. Verify provenance
  column defaults and constraints, and the complete worker relation contract,
  including effective runtime denial and immutable receipt triggers.
  Worker tables must be permanent logged relations. Connection provenance must
  remain a writable ordinary column, not an identity or generated column.

- The candidate schema-only controller accepts migrations `20260905202837`,
  `20260905205847`, and `20260905212822`, with their pinned SQL hashes over the verified
  448-migration Production prefix. The earlier two-migration release is already
  applied. The workbook rebuild authorization review must close before release.
  Source acceptance and Production authorization precede one transaction.
  A lost response permits reads only until ledger and catalog reconciliation.
  No export, restore, app build, import approval, or worker activation occurs.

- Release evidence, 2026-09-05: Production `fda53ee5` has the identical tree as
  accepted Development `383ea476`, private gitlink `88d5b79`, and the verified
  448-migration catalog. CI `33957447212`, hosted acceptance `33957164531`,
  and public app release `33958927462` passed. Workbook preparation and import
  commits are enabled at runtime-control revision 2. The first nine approved
  previews produced 1,111 committed rows, six completed queue items, and three
  blocked items. Two fresh Class of 2029 previews completed after a
  provider-version refresh, updating another 150 rows. Official reconciliation, remaining officer
  workflows, provider email settlement, and synthetic media remain open in
  the cleanup register.

- Workbook follow-up `df79bcb4` passed private CI `33989854176` and merged
  through PR #248 to private Development at `5ad7cfc0`. Local plugin
  verification and 260 private test files pass.
  Root integration, hosted acceptance, and Production release remain pending.

- Officer workbook re-preparation uses an intent-bound request UUID and the
  existing leased worker. It preserves prior snapshots and never commits rows.
  Its local forward migration passes isolated replay with 7,069 assertions.
  Production application and schema promotion remain gated on hosted proof.

- Compound-name profile search normalizes both stored full-name orders like
  the query and keeps organization, active-record, permission, and 20-result
  limits. The local 450-migration replay passes 7,081 assertions and the exact
  release catalog check. Publication and hosted acceptance remain pending.

- Integration base root `f49227cb`; private Development gitlink `7597fdc`; Production ⊥.
- UI says `Class`; existing `cohort` schema identifiers stay.
- Stable profile + graduation class; term application/import alone activates term membership.
- Public organization page exposes join/claim entry only; class Stream/Activities/membership content requires authenticated authorized class access.
- Meetings chapter-wide under More; member dashboard visual model preserved.
- Real student data, attached source rows, secrets, and provider sends never enter
  repository artifacts, tests, logs, screenshots, recordings, or model prompts.
  Confirmed hosted Development may persist only bounded, protected preview
  evidence from real sources. It may not commit real chapter rows.
- Synthetic fixtures stay isolated local/CI by default. They may be seeded into
  an explicitly confirmed non-Production hosted Development branch through the
  target-fenced wrapper. Synthetic Production fixtures and real-row test data ⊥.
- Imports keep source identity, explicit tab/range/mapping, immutable preview, reconciliation, auth recheck, atomic commit.
- Drive file ids and provider versions identify linked sources; titles remain display text and never select an authoritative workbook.
- Private plugin commits precede root gitlink update.
- Guided tours are presentation only; they never approve, link, award, or submit records.
- Tour progress may live in versioned auth metadata because it controls presentation only; consequential workflow state remains server-owned and audited.
- Scale acceptance = 1,000 fictional members + 100 concurrent active sessions; real student load fixtures ⊥.
- Production/provider mutation requires post-Development action-time approval; code rollout never implies workbook commit or email send.
- Application appeals remain audited officer notes; club audits remain manual point-review evidence.
- One local gate run precedes one marked Development deployment. Production follows only after exact-tree hosted acceptance and uses one Production pull request merged with a merge commit, preserving the accepted Development SHA as an ancestor and the accepted tree unchanged.

§I

route: officer top nav → `Home | Classes | Applications | More`
route: class workspace → `cohorts/<cohortId>/<stream|members|activities|submissions>` + URL term state
route: legacy `points|meetings|verification` → compatible destination mapping
route: public organization → class cards → join code + sign-in/claim flow
service: class loader → explicit `{organizationId, cohortId, termId}`
service: public class loader → safe class identity + join eligibility metadata only
service: CSF tour completion → authenticated server action + organization/role/version key
service: officer point review → member claim + canonical activity/club + proof + club review + appeal history
form: point claim → stable `sourceKind|opportunityId|partnerClubTermId|description|termId|pointType|claimedPoints|activityDate|evidence` FormData contract
perf: CSF route response → active route-family component graph only; unrelated client references ⊥
db: stable class join code → organization + cohort + code digest + lifecycle; direct invitations unchanged
cmd: `bun run test:plugins`; `bun run typecheck`; `bun run lint`; `bun run db:validate`; `bun run csf:test:import:scale`; focused pgTAP; `bun run build`
cmd: `bun run csf:test:hosted:load` → exact hosted Development origin + explicit non-Production project confirmation + fictional accounts only
service: class workbook check → leased Drive revision read → unchanged receipt | durable changed-version preparation job
service: chapter application source → immutable Drive file id + one preview whose rows resolve their own configured class and term
service: passive class record match → signed account-name snapshot + one exact active unclaimed same-class candidate → member confirmation → one officer-review request
service: typed class record search → verified account + submitted name context → exact email link | one officer request
service: import approval → frozen ready-preview batch receipt → leased 10-row commit batches
service: point/profile queue read → `{items,nextCursor,unresolvedCount}`; proof signed for selected item only
service: communication worker → 125 attempts/minute max, 5 concurrent sends, 8 request starts/second, durable provider settlement
perf: acceptance → 1,000 members, 100 concurrent, read p95 ≤2.5s, mutation p95 ≤3s, 5xx <0.1%

§V

V1: ∀ officer shell → exact top nav Home, Classes, Applications, More; duplicate Members/Service top destinations ⊥.
V2: ∀ class workspace → exact tabs Stream, Members, Activities, Submissions + explicit URL term; current term default.
V3: class member count/list → selected term participation only by default; chapter directory total substitution ⊥.
V4: stable profile + class link survive term change; term membership requires accepted application or committed roster import.
V5: class code → one active permanent code/class, owner rotate/revoke, no automatic term membership; one exact verified-email match may connect; every passive or typed name-only match creates or reuses one officer-review request; name-only linking ⊥.
V6: public class payload → safe class identity + join entry only; Stream, Activities, terms, rosters, codes, comments, applications, submissions, proof, points, attendance, account state ⊥.
V7: class Stream/Activities read → authenticated authorized class member/officer only; draft/archived remain scoped; publication permission rechecked server-side.
V8: class Activities → class-targeted + chapter-wide records without duplication.
V9: class Submissions → selected class/term queues + existing review detail/range assignment; user-facing `Verification` destination ⊥.
V10: Meetings → one chapter-wide More workspace; class page mutation copy ⊥.
V11: Applications → one chapter inbox + current-term default + class/status/assignee filters; Appeals nested; decision email explicit separate confirmation.
V12: contextual import start → Applications, class Members, or Partner clubs; More Import history starts no duplicate generic flow.
V13: class/public loaders → route-required fields only; public loader never reuses privileged projection.
V14: new SQL function → explicit revoke/grant + reviewed role allowlist; tenant + actor permission rechecked under lock.
V15: fixture seed → isolated local/CI target proof by default; hosted Development only through the target-fenced wrapper with explicit non-Production branch confirmation; Production target and real-row fixture ⊥.
V16: old CSF deep links retain compatible redirect/mapping during migration.
V17: no real attached row value enters migration, fixture, test, screenshot, log, prompt, or committed artifact.
V18: private feature implementation may use `codex/*`; strict branch containment runs only after private commit merges to private `development` + root gitlink advances.
V19: ∀ CSF route response → exactly one active route-family section; unrelated route client component references and repeated-navigation renderer growth ⊥.
V20: linked historical class workbook → every term-coded tab discovered with exact term, range, header, class, fills, notes, and populated/template state; a changed Drive version prepares newly populated tabs on the next authorized class Settings/Home read; officer commit remains explicit; unrecognized tabs disclosed and skipped.
V21: legacy class activity slots → explicit mapping mode only; each populated slot = 1 point; repeated normalized labels aggregate; generic plain-label fallback ⊥.
V22: application analysis → deterministic header-only mapping first; incomplete mapping may request one tracked AI proposal containing bounded headers, column indexes, and redacted type/shape signals only; server validates the proposal against the current workbook, current-selection guard rejects stale results, manual fallback remains; student-row value, name, email, response, evidence, note, or comment model input ⊥.
V23: import identity → validated canonical email may auto-match; name-only candidate remains officer decision; one profile reused across distinct term tabs; same-term duplicate writes ⊥.
V24: import read path → one workbook parse/request, bounded diagnostics text, one authorized readiness RPC/load.
V25: member entry → accessible six-character class-code control; My CSF duplicate Activities/Submissions actions ⊥; point claim inherits current class semester with no member-facing class/semester control; identity-only review never invokes annotation AI.
V26: class join journey → code accepted, account confirmed, profile checked, then durable connected or officer-review receipt; a passive candidate asks "Is this you?" and the button reports its server result; loading animation never claims a later state before that result.
V27: profile match → exact verified-email record may connect; confirming one server-derived account-name candidate creates or reuses exactly one officer-review request; a typed name, changed candidate, duplicate, claimed record, or class conflict follows the same review boundary; name-only connection ⊥.
V28: first eligible CSF workspace visit → one versioned, organization-scoped tour for the viewer's effective member or officer role; completion/skip persists through an authenticated server action; role change may offer the other tour; automatic repeat ⊥ and Help replay remains available.
V29: tour step → stable visible anchor + truthful action-oriented copy + keyboard navigation + focus restoration + viewport-safe placement; missing/unauthorized anchor skips; reduced motion removes animated scrolling and transitions; tour never blocks the underlying workflow after dismissal.
V30: officer onboarding → Home work queue, Classes, Applications, and point-submission review are explained from real permitted destinations; member onboarding → class feed, meetings/deadlines, point summary, submission entry/status, and My CSF record are explained; unavailable destinations are omitted rather than simulated.
V31: application and point review decision → selected person/semester/source evidence stays visible, reject requires an inline reason dialog, pending action is disabled against repeat submission, success advances only after a durable server receipt, unknown outcome asks for refresh/reconciliation instead of claiming success.
V32: point claim source → one explicit Activity | Club | Other choice for members; Manual officer record staff-only; unavailable policy source ⊥; changing source clears stale linked IDs.
V33: Activity/Club choice → searchable current-semester authorized options + explicit empty state; Other → no linked activity/club + required plain-language description.
V34: proof control → native one-file FormData + shadcn Attachment presentation; filename, size, accepted types, 10 MB cap, private storage copy, remove/retry, server authority; fake byte progress ⊥.
V35: point claim form → compact mobile-first fields + fixed dialog header/footer outside the scrolling field body + keyboard/focus/reduced-motion support; existing authorization, proof lifecycle, retry/reconciliation, review semantics, and FormData names unchanged.
V36: member point claim context → current term from authorized member class context + hidden stable `termId`; missing current context disables submission; historical-term fallback and member-facing semester selector ⊥; server revalidation remains authoritative.
V37: class-scoped activity/post compose → class + current class term inherited from class workspace; redundant audience/class/semester selectors ⊥; broad officer compose may keep explicit scope controls when no class context exists.
V38: linked activity point claim → authorized current-term activity supplies exact configured point value + type; member credit controls ⊥; hidden stable FormData retained; mutation rejects changed or invalid configured credit.
V39: class activity/announcement compose → empty text entry fields carry no example placeholder copy; scheduling controls and activation ⊥; legacy scheduling requests refuse writes; saved drafts and manual publication remain.
V40: linked member without accepted current-term membership → class Feed + one truthful review/setup notice; points rail + agenda + member workflow links + first-use tour + their backing reads ⊥; refused/closed states never described as processing.
V41: post email acceptance → browser publication receipt + frozen positive audience + durable queued campaign + worker dispatch + local mailbox receipt; Development Resend proof uses synthetic `@resend.dev` only; queue ≠ delivery and student provider sends ⊥.
V42: officer member correction → class Members uses the semester already selected in the class header and exposes identity, account, points, meetings, and semester standing in one compact roster; permitted edits use narrow audited saves and accepted status still runs the application decision transaction; a separate semester-management flow or raw bulk overwrite ⊥.
V43: My CSF → profile identity + graduation class + current-semester service-point, activity, and attended-meeting totals + semester tabs containing exact activity names, meeting labels, attendance, credits, and submissions; application/eligibility/dues tracker and duplicate application actions ⊥. Passive account-name join match → "Is this you?" preview with name and class only + one confirmation action; activity history, roster detail, five-step progress tracker, and account-status card ⊥.
V44: class-history identity columns → standard spaced or compact first/last headers; one damaged identity header may be inferred only from one unclaimed pre-key column in a class-history source; application inference and explicit `not_mapped` override ⊥. Officer point review → canonical activity or club, member description, configured point rule, proof, club review state, sheet reference, and appeal history stay beside the decision; an open appeal can be decided there. Member personal-calendar connection UI and member-route calendar read ⊥.
V45: class join identity → verified-email auto-link or one officer request. The passive confirmation path binds organization, user, verified email, code, class, profile, normalized account name, account-name hash, and short expiry, but it supplies review context only. The database takes the shared organization identity lock before any row or narrower advisory lock, then creates or reuses one request unless verified email independently proves the connection. A replayed verified-email success remains connected only while the profile, organization access, sole active class, exact verified link, request, and supporting audit are current; drift revokes that exact link and reopens the same request. Manual-name confirmation through `p_confirmed_profile_id`, duplicate request, profile creation from a typed name, candidate activity disclosure, and every name-only connection ⊥; account + address attempt buckets atomic.
V46: class workbook → one organization/class registry + exact Drive revision + five-minute check lease; unchanged revision creates no tab read/preview; changed revision creates one durable preparation job; revoked owner or OAuth access blocks.
V47: workbook approval → one officer batch freezes ready preview ids and count-only evidence; a new approval locks each source and compares the preview's frozen mapping version with the current mapping, marks only the affected preview stale, and lets other ready previews queue; an exact request id replays its durable approval receipt, while the final worker claim rechecks the mapping before source evidence is consumed or rows are frozen; approval and settlement append immutable count-only audit events; the service role can directly read only the three worker-context tables and reaches every write or receipt read through an owner-executed function; every new `plugin_data` worker table revokes inherited service-role defaults before its exact regrant; service-role deletion of batch, item, row-batch, outcome, and commit receipts ⊥; conflicted/stale previews stay blocked; each ready preview commits independently through idempotent leased batches of ≤10 rows; lost response replays receipt, never row write.
V48: CSF reads → member Home grouped context + grouped stream decoration with every profile list ≤50; officer Home fields require their matching permission; member Home ≤10 external reads, officer Home ≤8; unresolved point/appeal queues keyset-paged 25, history 50; profile search min 2 chars/max 20 with atomic account/address limits; selected proof only; feed reply preview ≤3.
V49: communication dispatch → every minute, ≤125 attempts/run, ≤5 concurrent sends, ≤8 request starts/second; `Retry-After` preserved; 1,000 fake-provider attempts reach accepted or durable retry within 10 minutes, duplicate send ⊥.
V50: webhook rotation → versioned secret keyring + legacy single-secret fallback; verified raw-body signature before parse; replacement endpoint settles Development test event before old endpoint disable; raw message body/storage ⊥.
V51: scale release → 1,000 fictional members + 90 member/10 officer sessions for 15 minutes; read p95 ≤2.5s, p99 ≤5s, mutation p95 ≤3s, total error <0.5%, 5xx <0.1%, LCP <2.5s, INP <200ms, CLS <0.1, renderer crash ⊥, retained heap growth ≤20%; exact root/private SHA gates required.
V52: initial class workbook link → provider metadata and bounded grids read once, canonical term sources saved from that validated snapshot, exact Drive file generation registered, and one durable preparation job queued before the interactive request returns; populated-tab preview work in the request ⊥; replacement file generation blocks stale worker settlement.
V53: class-history commit identity → one valid canonical roster key from the same organization, class, and official workbook reuses the previously committed active profile across semester jobs; different workbook, invalid key, conflicting canonical email, or a key already bound to multiple profiles blocks reuse and stays in officer review; reused identity is recorded on the immutable row and in private audit evidence.
V54: background import refusal → queue receipt stores one closed operational code for allowlist, reconnect, missing file, trash, identity, MIME, incomplete evidence, source drift, or retryable source check; raw provider and database text ⊥; worker response may return the same closed code for operator diagnosis.
V55: timed-out import batch → only a confirmed PostgreSQL statement-timeout rollback with no receipt may split into smaller atomic batches; another missing receipt or a single-row timeout blocks without an automatic repeat.
V56: targetless class-history row with a roster key that does not equal normalized FirstLast or LastFirst → ambiguous officer review before commit; officer may match one existing profile or, with both import and profile authority, create one audited unclaimed profile only when the class has no active exact-name profile; immutable workbook evidence changes ⊥.
V57: background queue settlement → a missing or unauthorized approving actor terminalizes the import queue item, frozen batch item, parent counts, and settlement audit in one transaction; concurrent row-batch deliveries serialize on organization + request id before receipt lookup; a missing Drive owner blocks both refresh job and workbook registry.
V58: hosted session acceptance → 90 member + 10 officer sessions ramp over 60 seconds, remain active for the rest of the 15-minute run, and exercise review navigation at peak load; member-feed dates render from deterministic Pacific parts in server and browser; staff presentation toggles replace one history entry with one route request; hydration recovery, repeated route snapshots, and burst-only load substitution ⊥.
V59: member read and dispatch boundary → a pending profile link returns connection status only; classmate counts require current-term membership in the displayed class; activities require membership in their own term; one provider-start limiter covers the full cron invocation; a claimed worker pass stops provider work at the work deadline, gets one bounded settlement drain, and then stops database transport before the route ceiling. Any unsettled lease remains durable for the next recovery pass and is never blindly resent.
V60: hosted scale acceptance → a fixed `csf-load-fixture` organization contains 1,000 deterministic fictional profiles and exactly 90 member + 10 officer Supabase Auth identities; provisioning rejects Production, the real DVHS handle, identity reuse, and tenant drift without enumerating the auth directory; each load loop owns one distinct session and stays on the exact fixture route; a Development-only GitHub workflow requires the exact Vercel Preview and Supabase Preview checks, provisions through step-scoped secrets, exchanges the Vercel bypass secret for one Secure HttpOnly cookie without redirect following, runs the hosted gate, and publishes its exact-SHA status; Production schema deployment resolves that status to a completed successful run with the exact repository, workflow path, Development branch, and SHA, then accepts only a matching descendant tree.
V61: class Members search → controlled query with a 300 ms debounce after two characters + explicit Search + immediate clear; every submission resets paging and preserves class, term, standing, account, sort, and view state; results remain server-filtered inside the selected organization and class and match the exact displayed preferred-or-full name, including middle names.
V62: mixed-grade application workbook → one chapter source and immutable preview; every row derives its configured class and term from retained source fields; source-level fixed class, stale fixed-class scope, and cross-class overwrite ⊥.
V63: official Drive source → immutable file id + provider version + selected tab/range; matching a title or filename pattern alone ⊥.
V64: release build policy → ordinary feature branches, unmarked Development commits, and `main` Git pushes skip Vercel application builds; one marked Development release builds; the approved Production pull request uses a merge commit so its tree equals the accepted Development tree and the accepted SHA remains an ancestor; the confirmed Production workflow prebuilds that tree, applies and verifies schema first, then explicitly deploys the prebuilt application to Production.
V65: source mapping save → existing source computes one material fingerprint over class, source type, target and duplicate policies, columns, tabs, commit targets, population state, and bounded header digest; the database locks the source row and accepts a changed mapping only at current version + 1; exact current-version replay stays stable; stale lower version, skipped version, or a second distinct mapping at the same proposed version fails closed. New sources keep their initial version. Rollout advances any source with unsettled source-backed previews so V47 rejects work created before this boundary.
V66: workbook refresh worker → claim binds the exact workbook, Drive file, provider version, saved OAuth owner, worker actor, and non-null lease; heartbeat, preview open, publication, failure, and completion recheck that generation; stale worker settlement returns a retryable generation-loss receipt and cannot overwrite the current prepared version or discovered-tab snapshot.
V67: import row batch → only a closed constraint refusal may write a terminal row receipt; retryable or unknown database errors roll back without a receipt; expired retries receive bounded priority over fresh approvals with a five-attempt cap; queue completion settles only the current frozen approval item and recomputes its parent counts under lock.
V68: workbook generation recovery → a workbook blocked only for `workbook_generation_reprepare_required` may claim one metadata-check lease and queue its current generation; every other blocked or unlinked workbook remains closed until an officer fixes its cause.
V69: workbook source registration → the service-facing receipt contains exactly `sourceId`, `created`, `mappingVersion`, `sourceSettlement`, and `sourceGenerationCurrent`; generation-bound implementation detail remains owner-only and cannot widen the worker contract.
V70: staff presentation change → one authenticated database call verifies an active organization staff role and updates only that caller's member-or-officer view preference; the preference grants no capability; redundant server authorization reads and route cache invalidation ⊥.
V71: app-only Production release → explicit main-reachable source SHA and identical hosted-accepted tree; trusted quality/database/acceptance gates + exact private gitlink + live read-only schema compatibility; one Vercel-side Production build with existing protected secrets + staged health/authentication checks + verified alias promotion; failure restores prior app alias. Record the staged build ID before waiting, never retry an uncertain create request, and keep all CSF workers disabled at build and runtime. External-drive setup, database exports/restores/migrations, import approval, and CSF worker activation are excluded from this path. Controller-only edits do not invalidate acceptance of unchanged application bytes.
V72: self-confirmed account-name claim → one active, unclaimed same-class profile with the exact normalized full account name, including middle names; a short-lived policy-versioned token binds actor, organization, code, class, candidate, confirmed account email, and account-name snapshot. Confirmation rechecks current evidence under the organization identity lock. Typed names, duplicate names, other claims, changed candidates, and class or contact conflicts create or reuse one officer request. Persist connection basis as verified_email, self_confirmed_account_name, or officer_decision; existing unknown basis remains unknown. Replay and profile access honor the recorded basis without calling a name claim email verification. Editable account names remain an accepted impersonation risk. This explicit policy supersedes earlier verified-email-only clauses for passive account-name confirmation only; name-only import consolidation remains prohibited.

V73: CSF worker activation uses database-backed switches scoped to the exact public release SHA, without another app build. The runtime can read but cannot change switches. Operator transitions require an expected revision, immutable request receipt, fixed enable order, and public postcondition checks. Missing, malformed, or unavailable controls disable processing. Independent disables preserve queued receipts. A per-deployment exact-SHA Production build override must not enable automatic Git builds.

V74: workbook readiness retains source-key conflict checks within the hosted database request budget. Committed-lineage equality reads use an organization/class/source-key index. A failed Settings read must show a recoverable error, not an unlinked workbook. Raising the global timeout or dropping identity checks does not satisfy this requirement.
V75: officer import reconciliation stores match metadata separately from immutable raw and normalized source snapshots. Profile creation, row resolution, audit, and request receipts remain atomic. Meeting attendance retains reviewed match provenance without rewriting source evidence. Creating an unclaimed application profile never verifies a form email or approves term membership.

V76: class import identity review and annotation review are independent decisions. Either review order preserves the matched profile, annotation outcome, source snapshot, and separate audit events. Annotation review never clears an unresolved identity from readiness. Replays cannot replace a completed annotation decision or reopen a frozen import.

V77: new annotation decisions require a locked preview in completed or needs_resolution state and an unfrozen, not_started row. A stopped worker does not release the officer-approved freeze. Pending, running, failed, and cancelled previews cannot receive new review decisions or audit receipts. An exact existing request receipt remains readable after current authorization is checked.

V78: inline point decisions send the same required request receipt as the standalone review dialog. Identical retries retain the request ID. A changed decision uses a different ID. Concurrent clicks cannot submit the same control twice. An unconfirmed transport outcome blocks further decisions and queue navigation until the officer reloads the saved state.

V79: open point verification freezes student claim contents, not authorized officer decisions. A decision-only update revalidates the reviewer and preserves the claim's organization, profile, term, source, activity, amount, and evidence. Reclassifying a frozen student claim as staff data cannot bypass the freeze.

V80: the runtime server role cannot update point submissions through table or column grants. It must use the existing audited request actions. Canonical approvals and retries remain available. Release verification rejects restored direct-update grants.

V81: identity reconciliation locks the source preview before its row and requires completed or needs_resolution state. Pending, running, failed, cancelled, and commit-mode jobs cannot receive identity matches or skips. A repeated identity decision rechecks the current preview state before returning its result. Refusal changes neither row state nor audit history.

V82: officer workbook recovery stops only queued imports with zero attempts, no start time, and no lease. Running work and unknown outcomes refuse recovery. It preserves source rows, completed and failed receipts, and queue history. One stable request records the stopped queue IDs and fresh preparation receipt. Stopped previews remain frozen and become retry lineage, never editable originals.

V83: an officer may authorize ongoing safe updates for one linked source, mapping version, and explicitly reviewed preview. The scope covers future rows in the selected columns and tabs. Changed headers require mapping review. Every automatic commit claim and row write rechecks the saved consent generation, source revision, and approving officer. An automatic approval records the exact ready row IDs, source and payload hashes, and profile, class, and semester targets. Later-resolved rows require a new approval; they cannot enter an older batch. Pause stops further writes from an already-prepared preview. Existing links keep their prior authorization. Revoked permissions, changed identity evidence, uncertain AI mapping, and conflicting officer corrections block affected rows. Source deletion never deletes member history.

V84: chapter-wide application linking preserves each response's class and source semester, including alumni. The linking action may create a missing review period only with review-period permission. It never reopens a closed period or turns imported responses into approved applications.

V85: saving a workbook-to-profile link requires explicit officer intent, the exact workbook and class, and one consistent prior source identity. Ordinary name matching creates no reusable link. Later semesters may reuse only an active reviewed link with unchanged source identity and no contact conflict. Revocation returns future unresolved rows to review. A retry never reactivates a revoked link.

V86: an active source authorization may create an unclaimed application profile only when its approving officer still has import and profile-management permission. Source evidence must pass the ordinary import checks. Record and commit-payload names must normalize identically, and the class must have the source semester configured. Existing name/contact candidates, duplicate responses, invalid targets, and unknown write outcomes require review. Each profile creation and row match is atomic and audited under the source authorization, without canonical email, application approval, or semester membership. Calls check locked candidates in order, stop after 50 profile creations, and never add targets to an already-frozen approval.

V87: a known blocked semester does not prevent unrelated workbook terms from preparing. The blocked term retains its existing receipts and remains in review. A finished preparation cycle records prepared, template, and blocked counts separately; it does not claim that every row imported. Unknown publication results, retryable provider failures, and expired worker authority still stop the generation without claiming completion.

V88: automatic class workbook metadata checks require explicit current source consent and both the source and workbook leases. Semester links share the workbook's five-minute check interval. The worker uses the Google owner's access while retaining the authorizing officer separately. An unchanged prepared revision creates no refresh job. A changed revision queues existing preparation, not a profile or application write. Pause, permission loss, another organization, and stale leases cannot advance the workbook version. Metadata settlement never advances the prepared-preview checkpoint.

V89: authorized class row growth does not rewrite the saved mapping or its version. Retain the reviewed columns, point rules, and caller settings when the file, owner, class, semester, header position, and column bounds remain unchanged. Expand only the preview's row bounds within the existing cell limit. A changed active mapping or failed consent read stops registration before overwriting the source. New manual sources retain manual behavior.

V90: automatic class approval distinguishes the Google owner who prepared the preview from the officer who authorized updates. Both retain current organization permission. The preview must belong to the completed workbook generation with matching source, owner, provider version, reviewed headers, and consent generation. Advance its prepared checkpoint and queue safe rows in one transaction; a refusal rolls both back. Old manual previews never acquire automatic authority through this entry point, and empty previews create no rows or approval receipt.

V91: the existing workbook worker discovers completed automatic class previews durably, without relying on the original preparation response. It dispatches at most eight previews per run. A saved source checkpoint prevents repeat dispatch. Review-only or explicitly blocked terms do not prevent another term from dispatching. Unknown database outcomes stop the run without repeating the call; future work reads the persisted checkpoint and queue receipts. Worker responses contain counts only and obey the existing disable switch.

V92: a populated automatic class commit retains exact activity labels and points, shares one catalog definition across participating profiles, and links attendance to the named semester meeting. Replaying a saved batch request creates no duplicate profiles, participation, attendance, or row receipts. Finalization reports successful rows beside unresolved siblings as partially completed, without hiding the remaining officer review.

V93: class Settings exposes source consent beside each linked semester using the existing audited enable and pause actions. Enabling requires a sealed preview of that exact source file and current mapping version, plus explicit officer confirmation. A stale or absent preview still permits pausing saved authorization. Closed controls perform no authorization-status reads. Semester consent does not authorize other tabs or change old manual links on page load.

V94: refreshing a paused, blocked, disconnected, or manual class source preserves saved column corrections, point rules, duplicate policy, and caller settings when its file, owner, class, semester, and column layout still match. Only the detected row range and population state change, with the ordinary mapping-version increment. Retaining settings grants no automatic authority. Incompatible layouts require review before registration can replace the saved mapping.

V95: known class mapping drift records a source-scoped review notice and blocks only that semester's registration and preview. Preserve its old sources during cleanup. Other terms can finish preparation, and the workbook result lists registered and blocked terms separately. Failed reads, lost authority, or failure to persist the review notice still stop the generation without claiming completion.

V96: the follow-up migration controller accepts only the reviewed eight-file tail after the exact 460-version Production prefix. Pin every file's bytes. A matching ledger alone cannot settle a release with a different schema catalog or permissions. Keep workers disabled, submit the transaction once, and resolve a lost response through reads without resending it. Controller test success does not authorize deployment of an unaccepted application candidate.

V97: class Settings offers approval and row review only for a sealed preview matching the current source file and mapping version. An outdated preview shows a preparation notice and triggers no readiness or queue reads. Keep prior successful commits visible as history. An in-progress preview does not fall back to an older approval candidate.

V98: an authorized profile merge carries active reviewed workbook links to the surviving profile in the same transaction. Preserve the original officer, source key, review row, reason, and request identifier. Retain the full pre-merge link in the protected audit. Revoked links stay attached to the original profile. The existing merge identity checks and request receipt remain authoritative; a reviewed workbook link does not permit a name-only merge.

V99: an officer can explicitly extend a reviewed class layout to matching canonical semester tabs in the same class workbook. Older source consent does not expand. New tabs retain the original officer, Google owner, reviewed header signature, and parent consent generation. Different columns, point rules, classes, workbooks, or owners require review. Parent pause or permission loss invalidates inherited authority before any row write. A separately reviewed child tab can become independently authorized. No source deletion removes student history.

§T

id|status|task|cites
T1|x|baseline merged root/private tree + encode approved class-first contract|V17,I.cmd
T2|x|replace officer nav + Home + class shell/tabs/term state + compatibility mapping|V1,V2,V9,V10,V16,I.route,I.service
T3|x|build term-aware class Members, Activities, Submissions + contextual imports/review queues|V2,V3,V4,V8,V9,V12,V13,I.route,I.service
T4|x|add permanent class-code schema/actions/UI + exact identity/term-membership boundaries|V4,V5,V14,V17,I.db,I.service
T5|x|add safe public class cards/Stream/Activities + publication contracts|V6,V7,V13,V17,I.route,I.service
T6|~~|consolidate Applications/Appeals/Meetings/More + remove redundant entry points|V1,V10,V11,V12,V16,I.route
T7|~~|harden fixture target fences + add DB/unit/component/browser/privacy coverage|V3,V4,V5,V6,V7,V8,V9,V11,V12,V13,V14,V15,V16,V17,I.cmd
T8|~~|run full gates, commit private first, merge/checkout private development, advance root gitlink, record exact evidence|V14,V15,V17,V18,I.cmd
T9|x|isolate CSF route rendering, add regression coverage, and prove bounded repeated-navigation renderer footprint|V13,V19,I.perf,I.cmd
T10|x|replace public class content with join/sign-in/claim flow + authenticated class-content authorization|V4,V5,V6,V7,V13,V14,V16,V17,I.route,I.service,I.db
T11|x|repair class/application imports + all-term discovery + comments + profile reconciliation + read performance|V4,V12,V14,V17,V20,V21,V22,V23,V24,I.service,I.db,I.cmd
T12|x|simplify member entry/My CSF + correct point-claim defaults + separate sheet-marking and identity review|V5,V17,V23,V25,I.route,I.service,I.cmd
T13|x|replace the legacy CSF member card tour, add the officer tour, polish join/profile-match transitions, and harden application/point review interaction states|V17,V26,V27,V28,V29,V30,V31,I.route,I.service,I.cmd
T14|x|redesign point claim source pickers, searchable Activity/Club choice, Other path, and shadcn Attachment proof UI|V17,V32,V33,V34,V35,I.form,I.cmd
T15|x|infer member point and class-scoped compose context; remove redundant class/semester controls|V17,V25,V36,V37,I.form,I.route,I.cmd
T16|x|auto-apply linked activity credit and remove compose filler/scheduling notice|V17,V32,V33,V35,V36,V38,V39,I.form,I.cmd
T17|x|reduce pending-member Home to Feed/status and prove post email dispatch|V7,V13,V17,V25,V28,V30,V40,V41,I.route,I.service,I.cmd
T18|x|make class member records spreadsheet-like with selected-semester standing and direct audited edits; verify approval, appeal, officer, and pending-member flows with synthetic browser evidence|V4,V11,V17,V20,V26,V31,V40,V42,I.route,I.service,I.cmd
T19|x|replace the My CSF application tracker with a semester profile and reduce class joining to safe profile confirmation; verify exact activity, meeting, and point history on desktop and mobile fictional fixtures|V17,V23,V25,V26,V27,V43,I.route,I.service,I.cmd
T20|x|repair compact and damaged historical identity headers; put club, proof, and appeal evidence in the point queue; open applications by application subject; remove the member calendar connection|V17,V20,V23,V31,V44,I.route,I.service,I.cmd
T21|x|remove legacy name-only linking; rate-limit join/search; align current onboarding and Class 2030 docs|V5,V17,V23,V27,V43,V45,I.route,I.service,I.db,I.cmd
T22|x|add class workbook registry, revision leases, changed-version preparation queue, and worker|V14,V17,V20,V22,V24,V46,I.service,I.db,I.cmd
T23|x|add count-only batch approval and idempotent 10-row background import commits|V14,V17,V20,V23,V24,V31,V47,I.service,I.db,I.cmd
T24|x|group Home/settings reads; page point/appeal queues; bound proof, profile search, and replies|V3,V9,V13,V19,V31,V42,V43,V48,I.service,I.perf,I.cmd
T25|x|rotate Resend webhook safely; raise bounded dispatch throughput; split runtime secrets and add alerts|V14,V17,V41,V49,V50,I.service,I.cmd
T26|~~|add 1,000-member/100-session acceptance, require full CI gates, merge private first, and stage Development|V15,V17,V18,V19,V41,V51,I.perf,I.cmd
T27|~~|move initial class workbook preparation out of the linking request, prove exact file-generation retries, and reconcile the four official Development workbooks before Production promotion|V14,V17,V20,V46,V47,V52,I.service,I.db,I.cmd
T28|~~|reuse one source-backed profile across semester commit jobs, deploy the exact Development tree, and complete the count-only officer reconciliation|V14,V17,V20,V23,V47,V53,I.service,I.db,I.cmd
T29|~~|retain privacy-safe background import refusal codes, restore service-only class-history readiness execution, deploy the Development source allowlist, and resolve the official workbook commit blocker before Production promotion|V14,V17,V46,V47,V54,I.service,I.db,I.cmd
T30|~~|split confirmed timed-out import batches, keep uncertain outcomes non-retryable, suppress ordinary feature-branch Vercel builds, and finish the official Development reconciliation in one release batch|V14,V17,V47,V55,V64,I.service,I.db,I.cmd
T31|~~|surface invalid class-history roster keys before readiness, add audited no-match profile creation, and settle the remaining Class of 2027 Development previews|V14,V17,V20,V23,V47,V53,V56,I.service,I.db,I.cmd
T32|~~|settle claim-time queue refusals, serialize concurrent row-batch receipts, block ownerless workbooks, and complete the hosted load gate|V46,V47,V51,V57,I.db,I.perf,I.cmd
T33|~~|remove member Home timezone hydration recovery, stop staff-view route snapshot retention, ramp the hosted sessions correctly, and complete the exact Development load gate|V19,V51,V58,I.perf,I.cmd
T34|~~|close the final profile-read and communications review findings, rerun exact Development acceptance, and promote the accepted tree to Production|V45,V48,V49,V51,V59,I.db,I.service,I.perf,I.cmd
T35|~~|mint 100 independent hosted auth sessions, bind Production promotion to the exact accepted Development tree, and complete the gated release|V18,V51,V60,I.perf,I.cmd
T36|~~|accept the repaired Members search, passive account-name confirmation, typed-name review, mixed-grade application import, and immutable Drive source identity in hosted Development before Production promotion|V5,V17,V26,V27,V43,V45,V61,V62,V63,V64,I.route,I.service,I.db,I.cmd
T37|x|serialize concurrent source mapping saves, persist the bounded attendance header digest, and invalidate previews created before the mapping boundary|V14,V17,V20,V22,V24,V47,V65,I.service,I.db,I.cmd
T38|x|bind workbook preparation to one Drive generation and prevent stale workers from publishing or settling replacement workbook state|V14,V17,V20,V22,V24,V46,V66,I.service,I.db,I.cmd
T39|x|preserve retryable and unknown import outcomes, bound retry fairness, and settle only the current approval item|V14,V17,V20,V23,V47,V57,V67,I.service,I.db,I.cmd
T40|~~|pass exact-tree gates and hosted Development acceptance for the final workbook, import, identity, selected-term member count, and member-search fixes before Production promotion|V3,V14,V15,V18,V51,V53,V60,V61,V66,V67,I.perf,I.cmd
T41|x|repair generation reprepare recovery, close the source-registration receipt, validate all four current Development workbooks, and promote the accepted tree through the gated Production workflow|V14,V17,V20,V46,V47,V66,V68,V69,I.service,I.db,I.cmd
T42|~~|reduce the hosted staff view-switch mutation below the three-second p95 limit, rerun exact Development acceptance, and promote only the passing tree|V18,V51,V58,V60,V70,I.perf,I.db,I.cmd
T43|~~|add and verify an app-only release controller, publish the already accepted application, then complete profile claiming and official reconciliation in a separate tested release|V18,V51,V60,V71,I.cmd
T44|~~|implement exact full-account-name confirmation, policy-versioned tokens, connection provenance, replay/access checks, officer revocation, and synthetic database/browser acceptance in one follow-up release|V5,V17,V23,V27,V43,V45,V72,I.route,I.service,I.db,I.cmd

T45|~~|replace per-worker rebuilds with audited runtime switches, verify permissions and receipt recovery, and repair the explicit Production build-policy override before the grouped follow-up release|V18,V51,V60,V71,V73,I.cmd,I.db
T46|~~|recover blocked workbook queues through audited officer intent, prove fresh review and unchanged repeat sync, and preserve every earlier receipt|V47,V67,V77,V82,I.db,I.service,I.cmd
T47|~~|authorize ongoing source updates explicitly, add bounded due-source processing, and verify pause, revoked permission, changed mappings, and mixed safe/conflicting rows|V47,V65,V66,V83,I.db,I.service,I.cmd
T48|~~|finish chapter-wide historical and Fall 2026 application reconciliation, missing review-period setup, account linking, and officer access acceptance|V5,V62,V75,V84,I.db,I.service,I.route,I.cmd
T49|~~|save and revoke reviewed cross-semester workbook profile links, integrate officer controls, and prove identity conflicts and retry behavior before release|V14,V47,V81,V85,I.db,I.service,I.route,I.cmd

§B

id|date|cause|fix
B1|2026-08-16|strict containment invoked before private feature implementation/promotion|V18
B2|2026-08-16|private PR #53 requires independent approval; auto-merge is disabled and branch protection was not bypassed|V18
B3|2026-08-17|all five route families rendered into every CSF server response; repeated soft navigation retained unrelated Flight/client graphs until Chrome renderer termination|V19
B4|2026-08-17|multi-date meeting migration replaced the locked authorization wrappers; private candidate also assumed host changes that had not reached development|V14,V15,V17,V18
B5|2026-08-17|private source contract coupled a JSX assertion to one-line formatter output|assert semantic JSX structure with whitespace-tolerant matching
B6|2026-08-17|db:validate reached its shared-instance stage with no local Supabase running|use the isolated replay gate for schema proof; report filename checks separately
B7|2026-08-17|private account-link label changed without the root operator documentation contract|update cross-repository operator labels in the same root integration and run the contract test
B8|2026-08-17|a static import of the newer Next cache refresh export broke Bun tests whose next/cache mock exposed only revalidatePath|load refresh at the successful Server Action boundary and keep legacy mocks isolated
B9|2026-08-17|two integrated commits inserted the same F26 term fixture into the recovery-seat pgTAP test|retain one lifecycle-aware term fixture and rerun the exact database test before the full replay
B10|2026-08-17|two root Playwright journeys still queried the pre-rename Account connections region|select the shipped Needs account link accessible name in identity and people-lifecycle acceptance
B11|2026-08-17|concurrency pgTAP checks identified queued sessions through runner-dependent pg_stat_activity query text|identify the exact ungranted staff-access advisory lock directly with a bounded cold-runner deadline
B12|2026-08-24|legacy class ledgers encode one point per populated activity slot; parser accepted explicit numeric text only|V21
B13|2026-08-24|historical Google source UI and save action replaced source mappings with one manually selected tab|V20
B14|2026-08-24|application analysis requests lacked current-selection identity and stale responses could replace current plan|V22
B15|2026-08-24|application analysis prompt serialized verbatim student cells and exposed no manual fallback|V17,V22
B16|2026-08-24|uploaded preview parsed bytes four times; readiness loaded 17 requests; diagnostics rendered full row-number arrays|V24
B17|2026-08-24|multi-term history could not reuse one explicit source plan, producing repeated manual matching and conflict work|V23
B18|2026-08-25|identity-only class review offered a large annotation-model call; the 15-second cutoff hid the wrong routing and the provider later returned no structured output|V23,V25
B19|2026-08-29|pending linked members rendered approved-member tools and fetched their data; post browser acceptance stopped at queue creation before worker/mailbox proof|V40,V41
B20|2026-08-29|class member edits hid semester standing behind a separate profile path, used the globally current semester instead of the class-selected semester, and left point appeals outside Applications|V11,V42
B21|2026-08-30|soft App Router tab changes removed visible CSF content but retained each detached review tree and its listeners, causing linear renderer growth|V19
B22|2026-08-30|application rows opened by profile id instead of application subject id; compact historical identity headers blocked populated tabs; point decisions split club and appeal evidence across workspaces|V31,V44
B23|2026-08-30|legacy exported name-confirm actions and RPC could link one unique normalized-name record outside current officer-review journey|V45
B24|2026-08-30|Officer Home reran full Drive tab reads and previews once per browser session without a revision lease|V46
B25|2026-08-30|1,000-row import required at least 2,000 sequential PostgREST calls inside one Server Action|V47
B26|2026-08-30|point queues signed every proof and routine staff selectors loaded the complete profile graph|V48
B27|2026-08-30|ten-minute cron + 25 sequential sends required about 6h40m for 1,000 recipients|V49
B28|2026-08-30|Production Resend webhook rejected every sampled delivery event because configured secret did not verify provider signatures|V50
B29|2026-08-30|direct 1,000-row fixture benchmark did not test authenticated route concurrency, browser memory, email, or Drive|V51
B37|2026-08-31|invalid populated class-history roster keys stayed pending after preview parsing, then failed only at database readiness with no officer row to resolve|V56
B38|2026-09-01|the class Members search field changed only browser input state, so typing never reached the URL-backed server query and dropped surrounding filters when submitted|V61
B45|2026-09-02|the class Members table displayed middle names that both paged server searches omitted from their combined-name expression|V61
B39|2026-09-01|the class join screen displayed a single exact account-name record, but its action produced no visible settled result and the only fallback copy implied every name match required officer approval|V26,V27,V45
B40|2026-09-01|the application importer retained a fixed class scope for a chapter-wide mixed-grade response workbook, so every valid row entered reconciliation under the wrong source-level assumption|V62
B41|2026-09-01|source reuse could follow a mutable Drive title instead of the stored file identity and provider version|V63
B42|2026-09-02|a mapping-only source edit left workbook bytes unchanged, so an older ready preview could pass provider-revision evidence and commit rows under superseded field mappings|V47
B43|2026-09-02|plugin_data default table privileges left seven workbook and import queue tables with unreviewed REFERENCES, TRIGGER, TRUNCATE, and receipt-deletion capabilities after their migrations granted narrower service operations|V47
B44|2026-09-02|two mapping saves could derive the same next version before either registry update locked the source row; meeting attendance kept its header digest only in preview state, so a distinct later header snapshot could share the first preview's version|V65
B46|2026-09-02|a stale workbook worker could finish after a newer Drive version arrived and overwrite the current prepared version and discovered-tab snapshot|V66
B47|2026-09-02|the import worker could write a terminal row receipt for an unknown database failure and leave current batch state inconsistent across retry or refusal paths|V67
B48|2026-09-02|the class header derived its selected semester from the validated current-or-newest fallback while the Members read used only the raw URL term, so a clean class URL could show the selected semester with zero rows|V3,V61
B49|2026-09-02|the hosted load workflow depended on missing account-pool secrets, targeted the real DVHS route, and injected its Vercel bypass credential into browser requests where redirects could forward it|V15,V51,V60
B50|2026-09-02|separately prepared semester rows with the same stable no-email workbook key could each create a profile because the resolver did not see the earlier row written in the same bounded batch statement|V14,V23,V47,V53
B51|2026-09-03|the generation-fence rollout marked every current workbook blocked for reprepare, while the metadata claim rejected every blocked workbook and could never start that recovery|V68
B52|2026-09-03|the generation-bound source registration added an implementation field to a closed five-field worker receipt, so successful source writes were reported as unknown outcomes and refresh jobs could not settle|V69
B53|2026-09-03|the first cross-term reuse repair treated a normalized student name as a stable workbook key when both rows lacked contact data, so two students with the same name could be merged|V14,V23,V47,V53
B30|2026-08-30|isolated auth admin and password-login requests repeatedly exceeded 30–60 seconds while database scale checks stayed fast|keep authenticated browser and 100-session acceptance open until the isolated auth runtime or hosted synthetic environment can sustain login
B31|2026-08-31|prepared class-history previews had valid roster keys but no profile targets, so batch readiness blocked every term and independent term commits would create duplicate profiles|V53
B32|2026-08-31|background import receipts collapsed allowlist and live Google source refusals into `import_commit_blocked`, hiding the safe operator action while preserving no diagnostic distinction|V54
B33|2026-08-31|the SECURITY INVOKER class-history readiness projection called two pure source-key helpers after their service-role execution grants had been revoked|grant only service_role access to those helpers in a forward migration; keep anon and authenticated denied
B34|2026-08-31|three activity-heavy class-history commits reached the hosted database request limit before a 50-row transaction could create its receipt|commit at most ten rows per atomic request while preserving receipt replay and the 25,000-row safety ceiling
B35|2026-08-31|the first ten-row retry cleared the database request limit but the 60-second web-worker ceiling stopped the fenced semester attempt before finalization|use the reviewed Pro function ceiling for the receipt-backed worker while every database transaction stays capped at ten rows
B36|2026-08-31|one activity-heavy ten-row Class of 2028 transaction still exceeded the hosted PostgreSQL statement timeout after 150 rows had committed|split only a confirmed statement-timeout rollback into smaller receipt-backed batches; keep every other missing receipt blocked and non-retryable
