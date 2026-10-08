# Let's Assist documentation

This directory is the canonical documentation home for humans and coding agents. Generated output belongs in ignored `.artifacts/`; only reviewed, synthetic evidence belongs under `docs/csf/evidence/`.

## Start here

- [Developer onboarding](development/onboarding.md)
- [Agent and tool configuration](development/agent-tooling.md)
- [Repository agent guide](../AGENTS.md)
- [Platform architecture](architecture/platform.md)
- [Local and hosted environments](development/environments.md)
- [Testing](development/testing.md)
- [Deployment boundaries](development/deployment.md)
- [Cleanup register](development/cleanup-register.md)
- [Development integration status](development/integration-status-20261007.md)
- [System audit, September 19, 2026](development/full-system-audit-20260919.md)
- [Audit register, 2026-08-10](development/audit-register-20260810.md)
- [Dependency modernization ledger](development/dependency-modernization.md)

## Architecture

- [Platform boundaries](architecture/platform.md)
- [Plugin boundaries](architecture/plugins.md)
- [Data and authorization boundaries](architecture/data.md)
- [AI key architecture](architecture/ai-keys.md)
- [Supabase redesign audit](architecture/supabase-redesign-audit.md)

## Development

- [Environment model](development/environments.md)
- [Testing and acceptance](development/testing.md)
- [Account data exports](development/account-exports.md): scope, private downloads, durable processing, and recovery.
- [Telemetry privacy](development/telemetry-privacy.md)
- [Source maintenance](development/source-maintenance.md)
- [Dependency security](development/dependency-security.md)
- [Deployment model](development/deployment.md)
- [Development maintenance cutover](development/development-cutover.md)
- [Private-plugin and submodule workflow](development/private-plugins.md)
- [Design system](development/design-system.md)
- [Plugin quickstart](development/plugin-quickstart.md)
- [Plugin install and entitlement guide](development/plugin-install-guide.md)
- [Signed plugin release integration](development/plugin-release-integration.md)
- [Supabase deployment workflow](development/supabase-deployment.md)
- [Database workload and retention plan](development/database-operations-plan.md)
- [Production cutover runbook](development/production-cutover-runbook.md)
- [Production request-guard bootstrap](development/production-request-fence-bootstrap.md)
- [Local fictional accounts](development/local-accounts.md)
- [Member import parser setup](development/member-imports.md)
- [Post-project suite: paper signups, feedback, follow-up email](development/post-project-suite.md)
- [Project cancellation worker](development/project-cancellation-worker.md)
- [Worker execution health](development/worker-health.md)
- [Public image cleanup](development/public-image-cleanup.md)
- [Google Cross-Account Protection](development/google-cross-account-protection.md)
- [Database simplification roadmap](development/database-simplification-roadmap.md)
- [Dependency modernization ledger](development/dependency-modernization.md)

## DVHS CSF

- [Subsystem overview](csf/README.md)
- [DVHS Fall 2026 operator guide](csf/dvhs-fall-2026-operator-guide.md)
- [Onboarding a new chapter](csf/new-chapter-onboarding.md)
- [Formal invariants](csf/invariants.md)
- [Product contract](csf/product-contract.md)
- [Officer runbook](csf/officer-runbook.md)
- [Testing, release, and residual risk](csf/testing-and-release.md)
- [CSF experience audit, September 25, 2026](csf/experience-audit-20260925.md)
- [Synthetic reference workbook](csf/reference/c-o-2028-synthetic.xlsx)
- [Real source-data layout and semantics](csf/source-data.md) (the files themselves live git-ignored in `docs/csf/source-data/`)
- [Current curated evidence](csf/evidence/20260806-post-cleanup/index.html)

## Archive

Archived documents are historical design context, not current operating instructions. Any still-actionable item must also appear in the cleanup register.

- [CSF review workspace design, 2026-08-02](archive/csf-review-workspace-design-20260802.md)

- [Archived Speech and Debate system](architecture/dv-speech-debate.md)
- [Archived Speech and Debate status](architecture/dv-speech-debate-status.md)
