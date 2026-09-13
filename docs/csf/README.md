# DVHS CSF subsystem

DVHS CSF is an organization-scoped private plugin for scholarship-federation operations: profiles and class cohorts, applications, evidence, activity points, meetings, partner clubs, imports, appeals, communications, term close, reports, roles, and audit history.

## Source of truth

Let's Assist is authoritative after import. Google Forms and Sheets supply application responses and historical evidence. Approved, restricted Sheet destinations can receive application, point-submission, and class exports under the [Sheet sync amendment](product-contract.md#sheet-sync-amendment-september-10-2026). Sheet decisions enter staff review before they can change a record. Comments stay in Let's Assist by default. Each live destination requires its own copied-workbook acceptance before it is enabled.

Drive retains the private evidence files. Officers can also download permission-checked reports. Google Classroom is retired; class posts and announcement email use the app's audience and delivery controls. Imports require explicit source identity, tab/range, mapping, preview, reconciliation, authorization recheck, and atomic commit. The [cleanup register](../development/cleanup-register.md) records deployed versions and current worker settings.

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
