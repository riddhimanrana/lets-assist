# Copilot instructions for lets-assist

The canonical repository instructions are in [`AGENTS.md`](../AGENTS.md). The documentation map is [`docs/README.md`](../docs/README.md). Read both before changing code, database migrations, private plugins, local environments, or release workflows.

This file deliberately does not restate those rules. An earlier copy of them drifted four months out of date; keeping one source avoids repeating that.

The boundaries below are repeated here only because they are costly to get wrong. `AGENTS.md` remains authoritative.

- Base work and pull requests on `development`. Do not mutate `main` or Production without explicit authorization.
- Supabase migrations are an append-only ledger. Never edit or squash a historical migration. Write a forward migration and add pgTAP coverage.
- Every new or replaced SQL function must explicitly `REVOKE` and `GRANT` execution for its reviewed roles. Client-callable `public` functions go in the architecture catalog allowlist in the same change.
- Keep the private submodule at its exact gitlink. Change the plugin repository first, merge there, then update the root gitlink.
- Never expose CSF roster, membership, evidence, attendance, or credentials through public or browser-direct data access.
- AI may draft or classify. Consequential CSF state changes require staff approval and server-side revalidation.
- Never commit secrets, real student data, raw browser traces, cookies, storage state, or generated reports.
