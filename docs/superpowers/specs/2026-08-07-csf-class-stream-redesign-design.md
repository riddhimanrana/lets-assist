# CSF class stream redesign — design spec

**Date:** 2026-08-07
**Status:** Approved direction (feed content, replies, and calendar depth confirmed by the chapter web master)
**Surfaces:** DVHS CSF member Feed (currently "Home"), officer cohort Stream, member rail

## Why

The chapter's real Google Classroom stream (screenshots reviewed 2026-08-07) was dominated by
activity posts — "Hero's Journey Park Cleanup TOMORROW (5/23)", "Project Blush Hygiene Drive",
"Nature Walk 5/24" — with chapter announcements the minority. Our current class feed carries
announcements only, so it will sit near-empty while the chapter's actual cadence (several
activity posts a week in season) happens in a tab members must remember to visit. GC also shows
an "Add comment" affordance, though no reviewed post carried a member comment; the chapter used
the stream as a broadcast medium with occasional officer follow-ups.

## Decisions (user-confirmed)

1. **Unified stream** — announcements and newly published activities interleave in one
   chronological feed. (Deadlines and meetings do NOT enter the feed; they are date-anchored,
   not feed events, and live in the agenda rail.)
2. **Officer-only replies** — officers holding `manage_posts` may append follow-up replies to a
   published post. No member comments. Replies inherit the parent post's audience and are never
   emailed.
3. **Agenda + mini month grid** — the rail's "Coming up" becomes a day-grouped 14-day agenda
   (activities + meetings + deadlines) beneath a compact month grid with event dots.

## Design

### Tab and information architecture

- The member landing tab is renamed **Home → Feed**. It remains the default member route and
  the landing surface; no fifth tab is added. Member tabs: **Feed / Activities / Point
  submissions / My CSF**.
- My CSF remains the deep record (requirements, history). The Feed's rail keeps a compact
  Requirements card linking there.

### The stream (member Feed and officer cohort Stream)

- **Card language, not rows.** Each stream item is its own `rounded-xl border bg-card` card
  with generous padding and clear inter-card spacing — the GC-roomy reference — replacing the
  hairline-divider rows currently used in the feed. Divider rows remain the idiom for status
  lists (My CSF); the feed is a stream, and streams get cards.
- **Two card kinds, one anatomy.** Header: 40px avatar (author) or tinted type-icon circle,
  author name + officer title, date, pin marker, officer overflow actions. Body: post text
  clamped at 3 lines with in-place "Read more". Activity cards add a footer chip row — date,
  points (`1.5 non-drive`), location — and one primary "View activity" action linking to the
  activity (which itself links onward to a Let's Assist project or external signup).
- **Type identity, quietly.** Announcement = megaphone tint, activity = calendar tint. Icon
  circle only; no loud borders.
- **Dates like GC.** Relative under 48 hours ("2 hours ago", "yesterday"), then short absolute
  ("May 27"), always with the full timestamp on hover. Month dividers ("May 2026") when the
  stream crosses a month boundary.
- **Pinned posts** stay a small always-on-top set with a quiet pin marker.
- **Officer replies** render nested inside the parent card: slim indented rows (avatar, name,
  short date, body) under the post body — visually GC-comment-like, authorable only by
  officers. Composer: a small "Add a follow-up" affordance on each post card visible to
  `manage_posts` holders only.
- **Motion.** Cards fade/rise ~8px on first paint with stagger, `motion-reduce` disables; hover
  elevation on interactive cards; Read more expands smoothly. Visible focus rings throughout.

### The rail

Order: **Requirements (compact) → Coming up → Actions** (unchanged order, new middle).

- **Mini month grid.** Compact current-month calendar, prev/next month nav, dot markers on
  days with events, today highlighted. Clicking a dotted day scrolls/highlights that day in
  the agenda below. Buttons with aria-labels; no drag/complex keyboard model.
- **Day-grouped agenda.** Next 14 days grouped under day headers ("Sat, Dec 5"), merging
  published activities, meetings, and term deadlines. Each row: time (if timed), title, points
  chip where applicable, and destination link. Footer link to Google Calendar sync in My CSF.

### Backend

- **Unified stream read.** New `listCsfMemberStream({ organizationId, userId, cursor })` in the
  plugin services: merges the existing posts query (existing audience/cohort scoping — public,
  members, class-matching) with published, member-visible activities (existing cohort scoping
  from the upcoming-activities service), ordered by `published_at DESC`. Composite keyset
  cursor `${publishedAt}|${id}|${kind}`; page assembled by fetching page+1 from each source
  past the cursor and merging. Author bylines batched exactly as today (two queries per page).
- **Officer replies.** New table `plugin_data.csf_announcement_replies`:
  `id, organization_id, announcement_id FK→csf_announcements ON DELETE CASCADE, body (1..4000),
  created_by FK→auth.users, created_at, updated_at`. Service-role-only grants + RLS posture
  matching sibling tables; forward migration + pgTAP (grants, FK cascade, body bounds).
  Actions: `addCsfPostReplyAction`, `deleteCsfPostReplyAction` (author-or-admin), both gated by
  `manage_posts`, audited via `recordCsfAuditEvent`, revalidating the feed paths. Replies load
  batched per feed page (one `IN` query), never one per post. No email, no pin, no audience of
  their own.
- **Agenda read.** Extend the existing upcoming-activities service (or sibling) to return the
  14-day window of activities + meetings + deadlines grouped client-side; meetings and
  deadlines already have member-visible reads used by the sidebar/snapshot today.

### Contract touch

Amendment 1 (v1.1) states "posts have no comments." Add a v1.2 note: member comments remain
excluded; officers holding `manage_posts` may append follow-up replies to their chapter's
published posts; replies inherit the parent audience and are never emailed.

### Out of scope (YAGNI)

Member comments or reactions; emailing replies; a full calendar page; feed read-tracking;
deadlines/meetings as feed items; any change to the platform `/home`–`/dashboard` DTO contract.

### Testing

- Unit: stream merge ordering + cursor round-trip; replies privacy (no email/user-id in DTO);
  reply gating; agenda grouping (day boundaries, timezone: America/Los_Angeles).
- pgTAP: replies table grants/FK/bounds.
- E2E: member sees interleaved activity card; officer adds a reply and the member sees it; the
  member composer never shows reply affordances; mini calendar dot ↔ agenda day match.
- Visual: capture screens at 1440 and 390 widths; officer Stream and member Feed.
