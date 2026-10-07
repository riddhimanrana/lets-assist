# Source maintenance

The source guard enforces the repository guide: 600 lines for route and
component modules, 800 for service/action modules, and 1,200 for tests.
Generated output and historical migrations remain exempt. The existing
dashboard data-phase allowance is 800 lines.

`scripts/source-maintainability-baseline.json` records 43 root modules and five
private-plugin modules that already exceed those limits at the reviewed source
revisions. These are open debt, not evidence that the modules meet the standard.
The guard permits their recorded size and refuses further growth. New files
receive no allowance. Remove an entry when its module falls below the limit;
do not regenerate the baseline to make a failing feature pass.

Split modules around owned behavior with a useful test boundary. Account export
and deletion sections now have separate components and service boundaries.
The next root priorities are project creation and signup, account authentication,
moderation, and waiver workflows. Keep public actions and product routes stable.
Extracting fragments solely to meet a number does not settle a design review.

Run `bun run source:check:organization` and
`bun test scripts/check-source-organization.test.ts`. Both the root checkout and
the exact private gitlink are checked. A private candidate may reduce baseline
entries when integrated after its reviewed merge.
