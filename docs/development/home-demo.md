# Home demo preview

The friendlier home/landing experiment is disabled by default. Set the server
variable `LETS_ASSIST_HOME_DEMO=1` only in an owned local development process or
an authorized Vercel preview. No hosted variable or flag service was changed.
Production and standalone production builds stay off even with the variable set.
The isolated preview route is `/preview/home-demo`; it returns 404 when disabled
and carries noindex/nofollow metadata.

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

Run the home flag/greeting/data/component/timer tests, the existing project-feed
lifecycle test, and the isolated `app/home/actions.occupancy.test.ts` and
`app/api/projects/route.test.ts` processes. Module-mocking tests must remain
isolated, as in the repository test runner. Check keyboard dialogs and state
switches, mobile overflow, both themes and reduced motion in the authorized
browser. Source tests are not a hosted or Production acceptance gate.

The broader guest history policy is a separate database deliverable. This demo
neither restores missing signups nor changes retention, scheduler state or RLS.
