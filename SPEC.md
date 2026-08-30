§G

DVHS CSF officer UX → class-first Home → Classes → Applications → More; class workspace → Stream → Members → Activities → Submissions.

§C

- Base root `52d623f3`; private gitlink `8cb12dd`; Production ⊥.
- UI says `Class`; existing `cohort` schema identifiers stay.
- Stable profile + graduation class; term application/import alone activates term membership.
- Public organization page exposes join/claim entry only; class Stream/Activities/membership content requires authenticated authorized class access.
- Meetings chapter-wide under More; member dashboard visual model preserved.
- Real student data, attached source rows, secrets, provider sends, hosted mutation ⊥.
- Synthetic fixtures stay isolated local/CI; hosted fixture leakage ⊥.
- Imports keep source identity, explicit tab/range/mapping, immutable preview, reconciliation, auth recheck, atomic commit.
- Private plugin commits precede root gitlink update.
- Guided tours are presentation only; they never approve, link, award, or submit records.
- Tour progress may live in versioned auth metadata because it controls presentation only; consequential workflow state remains server-owned and audited.

§I

route: officer top nav → `Home | Classes | Applications | More`
route: class workspace → `cohorts/<cohortId>/<stream|members|activities|submissions>` + URL term state
route: legacy `points|meetings|verification` → compatible destination mapping
route: public organization → class cards → join code + sign-in/claim flow
service: class loader → explicit `{organizationId, cohortId, termId}`
service: public class loader → safe class identity + join eligibility metadata only
service: CSF tour completion → authenticated server action + organization/role/version key
form: point claim → stable `sourceKind|opportunityId|partnerClubTermId|description|termId|pointType|claimedPoints|activityDate|evidence` FormData contract
perf: CSF route response → active route-family component graph only; unrelated client references ⊥
db: stable class join code → organization + cohort + code digest + lifecycle; direct invitations unchanged
cmd: `bun run test:plugins`; `bun run typecheck`; `bun run lint`; `bun run db:validate`; focused pgTAP; `bun run build`

§V

V1: ∀ officer shell → exact top nav Home, Classes, Applications, More; duplicate Members/Service top destinations ⊥.
V2: ∀ class workspace → exact tabs Stream, Members, Activities, Submissions + explicit URL term; current term default.
V3: class member count/list → selected term participation only by default; chapter directory total substitution ⊥.
V4: stable profile + class link survive term change; term membership requires accepted application or committed roster import.
V5: class code → one active permanent code/class, owner rotate/revoke, no automatic term membership, exact verified-email match only; name-only match ⊥.
V6: public class payload → safe class identity + join entry only; Stream, Activities, terms, rosters, codes, comments, applications, submissions, proof, points, attendance, account state ⊥.
V7: class Stream/Activities read → authenticated authorized class member/officer only; draft/archived remain scoped; publication permission rechecked server-side.
V8: class Activities → class-targeted + chapter-wide records without duplication.
V9: class Submissions → selected class/term queues + existing review detail/range assignment; user-facing `Verification` destination ⊥.
V10: Meetings → one chapter-wide More workspace; class page mutation copy ⊥.
V11: Applications → one chapter inbox + current-term default + class/status/assignee filters; Appeals nested; decision email explicit separate confirmation.
V12: contextual import start → Applications, class Members, or Partner clubs; More Import history starts no duplicate generic flow.
V13: class/public loaders → route-required fields only; public loader never reuses privileged projection.
V14: new SQL function → explicit revoke/grant + reviewed role allowlist; tenant + actor permission rechecked under lock.
V15: fixture seed → isolated local/CI target proof; hosted Development/Production target ⊥.
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
V26: class join journey → code accepted, account confirmed, profile checked, then durable connected or officer-review receipt; loading animation never claims a later state before the server result.
V27: profile match → exact verified-email record may be confirmed and connected; name-only or ambiguous candidate becomes one officer-review request; automatic name-only link and duplicate request ⊥.
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
V39: class activity/announcement compose → empty text entry fields carry no example placeholder copy; unavailable scheduling explainer ⊥; valid scheduling and scheduled-post recovery contracts remain.
V40: linked member without accepted current-term membership → class Feed + one truthful review/setup notice; points rail + agenda + member workflow links + first-use tour + their backing reads ⊥; refused/closed states never described as processing.
V41: post email acceptance → browser publication receipt + frozen positive audience + durable queued campaign + worker dispatch + local mailbox receipt; Development Resend proof uses synthetic `@resend.dev` only; queue ≠ delivery and student provider sends ⊥.
V42: officer member correction → class Members uses the semester already selected in the class header and exposes identity, account, points, meetings, and semester standing in one compact roster; permitted edits use narrow audited saves and accepted status still runs the application decision transaction; a separate semester-management flow or raw bulk overwrite ⊥.
V43: My CSF → profile identity + graduation class + current-semester service-point, activity, and attended-meeting totals + semester tabs containing exact activity names, meeting labels, attendance, credits, and submissions; application/eligibility/dues tracker and duplicate application actions ⊥. Exact verified-account join match → “Is this you?” profile preview + bounded recent activity names and points + one confirmation action; five-step progress tracker and account-status card ⊥. Name-only candidate activity disclosure and automatic connection ⊥.

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
