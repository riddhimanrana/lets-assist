# Plugin quickstart

This is the short operating guide for plugin development, installation, and
updates. Use the longer [private plugin guide](private-plugins.md) when changing
the SDK or release machinery.

## Plugin types

| Type        | Where it runs                                    | When to use it                                                           | How it updates                                                             |
| ----------- | ------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Embedded    | Compiled into the Let's Assist host              | Small UI or server hooks that need no separate deployment                | Release the plugin, then deploy the host                                   |
| Application | A separate Vercel app in the microfrontend group | A plugin that needs independent builds, logs, scaling, or release timing | Deploy the signed child build, then let an organization admin switch to it |
| Service     | A server-only process with no plugin UI          | Webhooks, imports, schedules, and other API work                         | Deploy the signed service and update its approved endpoint contract        |

A plugin can publish more than one runtime. DVHS CSF keeps embedded `1.1.0` as
its rollback target and publishes application `1.2.8` through the
`lets-assist-csf` Vercel project.

## Start local development

Run platform-only work in the shared local environment:

```bash
git switch development
git pull --ff-only
bun install --frozen-lockfile
bun run plugin:submodules:init
bun run plugin:submodules:check:strict
export CSF_LOCAL_TEST_PASSWORD="$(openssl rand -base64 24)"
export DV_LOCAL_TEST_PASSWORD="$CSF_LOCAL_TEST_PASSWORD"
bun run supabase
bun run dev:next
```

Keep that terminal open or save the generated value in a local password manager
for the current fixture run. The repository does not store fixture passwords.

Run DVHS CSF in its isolated environment when changing CSF or its application
runtime:

```bash
git switch development
bun install --frozen-lockfile
bun run plugin:submodules:init
bun run dev
```

`bun run dev` starts the isolated Supabase stack, fictional CSF fixtures, the
host on port 3000, and the CSF child app on port 3001. It must not connect to
hosted Development or Production.

## Work on a plugin with another coding agent

Git cannot check out one branch in two worktrees. Give each task its own branch
and worktree, then merge the reviewed result into `development`.

```bash
git fetch origin --prune
git worktree add ../lets-assist-plugin-task -b codex/plugin-task origin/development
cd ../lets-assist-plugin-task
bun run plugin:submodules:init
bun run plugin:submodules:check:strict
```

For private plugin code, create the task branch inside the private repository.
Merge and push that private change before updating the root gitlink. Never copy
private source into the public repository.

After the branch is merged, verify ancestry before removing it:

```bash
git fetch origin --prune
git merge-base --is-ancestor codex/plugin-task origin/development
git worktree remove ../lets-assist-plugin-task
git branch -d codex/plugin-task
```

Do not delete a worktree with local changes or untracked evidence. Move any
needed evidence to an ignored `.artifacts/` directory first.

## Verify before committing

Use the focused plugin gate while iterating:

```bash
bun run plugin:apps:contract
bun run plugin:test:unit
bun run typecheck
```

Run the strict gate before merging or tagging:

```bash
bun run plugin:verify:strict
```

Database changes still require a forward migration and pgTAP coverage. Do not
edit an old migration or advance an organization install from SQL.

## Release a new plugin version

1. Change the plugin on a private branch based on private `development`.
2. Update its manifest version, `release.json`, and `CHANGELOG.md` together.
3. Merge the private pull request and promote the same commit through private
   `main`.
4. Tag that exact commit as `<plugin-key>/v<version>`.
5. Let the private workflow build, create the SBOM, sign the release, and open
   the generated root integration pull request.
6. Merge the root integration into `development` after its focused checks pass.
7. For an application plugin, run `Deploy signed plugin application` for
   Development and verify its health.
8. Test the organization update and runtime switch in hosted Development.
9. Promote the reviewed root tree and schema to Production.
10. Deploy the same signed application release to Production. An organization
    admin can then choose the new runtime.

The organization install and the application runtime selection are separate.
That separation keeps the embedded runtime available for rollback.

## Use the admin console

Open `/admin/plugins`.

- **Overview** shows plugin type, signed versions, Vercel project, install
  counts, selected application runtimes, and health.
- **Organization access** grants or expires an entitlement. It does not install
  the plugin.
- **Data** shows each organization and plugin isolation boundary.
- **Plugin details** edits catalog identity and release policy. Routine updates
  do not need this form.
- **Advanced** contains force operations and raw configuration. Use it for
  recovery, not normal installation.

After a super admin grants access, the organization admin opens
`/organization/[id]/settings`, installs the plugin, and chooses an available
application runtime. The platform rechecks the signed release, compatibility,
deployment health, entitlement, install, and admin role at action time.

## Where to read next

- [Plugin install and entitlement guide](plugin-install-guide.md)
- [Signed plugin release integration](plugin-release-integration.md)
- [Private plugin development](private-plugins.md)
- [Plugin architecture](../architecture/plugins.md)
- [Local environments](environments.md)
