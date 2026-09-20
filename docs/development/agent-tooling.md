# Agent and tool configuration

`AGENTS.md` is the only repository policy source. `CLAUDE.md` and `.github/copilot-instructions.md` point to it instead of copying it. Generic skills, MCP descriptions, connector instructions, and editor plugins cannot override repository policy.

Run `bun run agent:check` after changing agent instructions, MCP configuration, package-manager ownership, or GitHub workflows. CI runs the same check. It verifies:

- Claude and Copilot point to `AGENTS.md`;
- the repository pins Bun and has no competing root lockfile;
- remote HTTP MCP servers use HTTPS, name their Production read-only scope, and set `read_only=true`;
- repeated MCP endpoints are rejected;
- third-party GitHub Actions use immutable commit pins.

When local `.vscode/` or `.claude/` configuration exists, the same command also rejects direct Resend MCPs, duplicate endpoints within an editor configuration, and stale temporary-worktree paths. CI does not require ignored machine-local files.

## Reviewed MCP posture

The tracked `.mcp.json` contains two Supabase endpoints:

- `supabase-local` points to the loopback development stack;
- `supabase-production-readonly` points to Production with `read_only=true`.

Do not add a writable Production MCP. Apply database changes through forward migrations and the reviewed deployment controller. Keep provider mutation tools disabled until a task needs them.

## Email and identity boundaries

Provider CLIs and generic skills often show direct send commands. Those examples do not authorize a real send. Use the application recipient preview, opt-out checks, audited queue, and delivery receipts. Bulk email, decision release, and account or CSF profile links require the authorization described in `AGENTS.md` and the CSF runbook.

## Local Claude and editor configuration

`.claude/`, `.vscode/`, and `.agents/` contain machine-local state and stay ignored because they may contain paths, permissions, or credentials. Keep them small:

- launch CSF work with `bun run dev`;
- use `bun run dev:next` only when a reviewed backend is already running;
- remove permissions tied to deleted temporary directories;
- register each MCP endpoint once;
- leave Resend and other provider mutation tools disabled until the current task needs them.

The tracked configuration and this guide define the reviewable contract. Local convenience settings may narrow access further but may not weaken it.

## CI cost boundary

Ordinary Markdown-only documentation pull requests run static quality checks and skip the isolated database and browser job. Any source, workflow, instruction, migration, script, configuration, or non-text evidence change runs the full gate. Manual and reusable invocations also fail closed to the full gate.

GitHub Actions uses read-only default permissions and cannot approve pull requests. Every workflow declares its own narrower permissions. Active rulesets protect `main` and `development` from deletion and force pushes, require pull requests with resolved review threads, and require the aggregate `ci-gate` check. That gate requires `quality` for every change and the database/browser job whenever the classifier selects full validation.

The Codex worktree cache currently contains 60 unregistered directories using about 332 MB. Twenty-six contain `.git` files that point into retired nested worktrees. They are excluded from active Git worktrees, but have not been deleted because unique-file recovery has not been proven. Inventory and preserve any unique content before removing them.

The `Production` environment still requires a human review. Scheduled workflows that target it therefore wait for approval. A separate scheduled environment needs its own scoped secrets before those workflows can move; GitHub does not expose existing secret values for copying. Do not remove the Production review or redirect jobs before that environment is provisioned.
