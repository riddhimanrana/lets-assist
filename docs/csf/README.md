# DVHS CSF subsystem

DVHS CSF is an organization-scoped private plugin for scholarship-federation operations: profiles and class cohorts, applications, evidence, activity points, meetings, partner clubs, imports, appeals, communications, term close, reports, roles, and audit history.

## Source of truth

Platform records are authoritative after import. Google Forms and Sheets are controlled read/import evidence channels, while Drive retains the private source files selected for review. This release does not write reports or compatibility exports to Google Sheets; officers download a permission-checked local ZIP containing formula-safe CSV files and a manifest. Google Classroom is retired for CSF; the member feed, cohort posts, and ledger-backed announcement email are the active broadcast workflow. Imports require explicit source identity, tab/range, mapping, preview, reconciliation, authorization recheck, and atomic commit.

## Product shape

Preserve the established officer workflows: sheet-like point processing, profile-first member records, dedicated meeting and partner-club workspaces, granular staff roles, visible audit history, and the white/green Shadcn organization shell. Refactors may improve hierarchy, responsive behavior, keyboard access, terminology, and empty/error states without replacing these workflows with a generic dashboard.

## Required reading

- [Formal invariants](invariants.md)
- [Product contract](product-contract.md)
- [Officer runbook](officer-runbook.md)
- [Testing, release, and residual risk](testing-and-release.md)
- [Synthetic workbook](reference/c-o-2028-synthetic.xlsx)
- [Curated evidence](evidence/20260806-post-cleanup/index.html)

The implementation lives in `lib/plugins/private/plugins/dvhs-csf`; the root repository owns the integration boundary, migrations, launchers, and acceptance orchestration.
