# Home demo preview

The public landing page defaults to real content. A super admin can switch
**Demo preview on the landing page** from the admin overview. This is a global
setting for everyone viewing the landing page, including Production. Home
dashboards, real projects, signups, and activity records are unchanged. The
admin's **Open landing page** link uses `/?noRedirect=1` so the existing
signed-in redirect does not hide it during a demo.

`20261011100000_landing_demo_mode.sql` installs one private singleton row with
the mode off. Only service-role RPCs can read or update it; browser roles have
neither table access nor function execution. Public rendering gets only a
boolean through the server. Unknown, unavailable, or malformed reads leave
sample content off. The admin control distinguishes this from a confirmed off
setting and disables saving until it can read the current mode.

Every admin read and save checks the current auth record, super-admin app
metadata, and enrolled MFA through `checkSuperAdmin`. The write RPC separately
verifies the actor's current authoritative app metadata and records actor/time.
An append-only private event log retains both on and off transitions; failed
or stale saves add no event.
It compares the last acknowledged mode before changing it, so stale controls
cannot overwrite another admin's change. A failed save keeps the previous
mode, shows an error, and requires refresh for a stale setting. Saving
expires the public display cache and revalidates `/` and `/admin`. Public mode
reads use a backend-bound 30-second cache; admin reads always query the current
setting. `updateTag` immediately expires the public cache after a saved change,
so the next landing request waits for fresh data. The proxy permits the explicit
public GET `/?noRedirect=1` without skipping guards on protected routes or POSTs.
Visitors already on an open page see the change on reload. Deployment does
not enable the demo; an admin must flip the switch explicitly.

For a fictional local fixture independent of the database, set the server
variable `LETS_ASSIST_HOME_DEMO=1` in an owned development process or authorized
Vercel preview and open `/preview/home-demo`. This route always refuses
Production and carries noindex/nofollow metadata. The environment flag no
longer controls the public landing page or normal home dashboards.

The greeting uses the visitor's browser timezone after hydration and refreshes
at midnight and when a hidden page becomes visible. It uses an existing display
name, never an email prefix. The server and anonymous fallback is “Hi there.”

The sample experience has a permanent notice, labels on each counter and
project, and six fictional projects. The initial 5,000 users and 492 US projects
are sample values, not verified activity. Counters change every four seconds,
pause while hidden or under reduced motion, and stop at a fixed cap. Examples
have demo-only IDs and local preview dialogs; they never enter the real project
feed, database, signup flow or activity metrics.

The real feed remains separate. It requests upcoming public projects through
existing discovery and occupancy boundaries. Empty, filtered, access-denied,
loading and failure states are distinct; access-denied copy is used only for an
actual HTTP 401/403. Unlisted projects require their shared link, and
organization-only visibility remains governed by existing membership rules.
Database failures propagate to the existing retryable API response rather than
becoming a successful empty list. No trusted-member requirement was invented.

## Focused verification

Run the landing-mode reader/action/page tests in separate Bun processes, the
`landing_demo_mode.test.sql` pgTAP authorization, audit, and state tests, plus the
proxy landing-link regression, then the home
flag/greeting/data/component/timer tests, the existing project-feed
lifecycle test, and the isolated `app/home/actions.occupancy.test.ts` and
`app/api/projects/route.test.ts` processes. Module-mocking tests must remain
isolated, as in the repository test runner. Check keyboard dialogs and state
switches, mobile overflow, both themes and reduced motion in the authorized
browser. Source tests are not a hosted or Production acceptance gate.

The broader guest history policy is a separate database deliverable. This demo
neither restores missing signups nor changes retention, scheduler state or RLS.
