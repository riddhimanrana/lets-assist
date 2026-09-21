---
name: lets-assist-delivery
description: Deliver Let's Assist code, plugin, database, CI, or release work efficiently. Use when implementing, fixing, integrating, testing, opening a PR, or preparing a release in this repository.
---

# Let's Assist delivery

Read `AGENTS.md`, then load the area-specific documents it points to.

Keep one coherent deliverable on one branch and pull request. Reuse an existing pull request for review fixes and check failures. Separate work only at an independent product or release boundary.

Use a tight local loop:

1. Identify the smallest behavior boundary and its nearest focused test.
2. Implement and run that proof locally.
3. Run only the static checks affected by the change.
4. Record exact local evidence before integration.

The pull-request `ci-gate` is a short independent check. It does not replace local focused tests. Run the full `Code quality` workflow once for the integrated release candidate or through the reusable Production preflight. That full run owns the build, full tests, isolated database replay, scale checks, and browser suites.

For private-plugin work, finish the private repository change first, then update the root gitlink once. Keep local, hosted Development, and Production evidence separate.
