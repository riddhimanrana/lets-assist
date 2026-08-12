import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// Migration 20260811180000 removed the self-satisfying
// `type = 'verified' AND auth.uid() = creator_id` branch from every
// certificates write policy, so `authenticated` can now write only its own
// detached, uncertified self-reported rows. That contract only holds while the
// application keeps issuing verified certificates from privileged code. These
// assertions fail the moment a new browser-reachable certificate write appears.

const SEARCH_ROOTS = [
  "app",
  "components",
  "emails",
  "hooks",
  "lib",
  "schemas",
  "scripts",
  "services",
  "utils",
];
// Quote style, comments, and line breaks between the table and the verb are all
// tolerated so the inventory cannot be evaded by formatting.
const MUTATION =
  /\.from\(\s*["'`]certificates["'`]\s*\)\s*(?:\/\/[^\n]*\n\s*)*\.(insert|update|delete|upsert)\b/gu;

// Every file allowed to mutate public.certificates, and the identity it must
// use. `service` means the service-role client, which bypasses RLS by design;
// `session` means the caller's own session, which RLS holds to the
// self-reported envelope.
const ALLOWED_WRITERS: Record<string, "service" | "session"> = {
  "app/api/self-reported-hours/route.ts": "session",
  "app/api/self-reported-hours/[id]/route.ts": "session",
  "app/api/cron/auto-publish-hours/route.ts": "service",
  "app/anonymous/[id]/actions.ts": "service",
};

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const root of SEARCH_ROOTS) {
    let entries: string[];
    try {
      entries = readdirSync(root, { recursive: true }) as unknown as string[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = `${root}/${entry}`;
      if (!/\.tsx?$/u.test(path)) continue;
      if (path.includes("node_modules/")) continue;
      if (path.startsWith("lib/plugins/private/")) continue;
      files.push(path);
    }
  }
  return files.sort();
}

test("only the inventoried write paths mutate public.certificates", () => {
  const writers = sourceFiles().filter((file) => {
    MUTATION.lastIndex = 0;
    return MUTATION.test(readFileSync(file, "utf8"));
  });

  assert.deepEqual(
    writers,
    Object.keys(ALLOWED_WRITERS).sort(),
    "a new certificates write path appeared; classify its client identity and " +
      "re-check it against the RLS contract in migration 20260811180000 " +
      "before adding it here",
  );
});

test("browser-reachable certificate writes never declare a verified type", () => {
  for (const [file, identity] of Object.entries(ALLOWED_WRITERS)) {
    if (identity !== "session") continue;
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /type:\s*"verified"/u,
      `${file} runs on the caller's session and must not mint verified certificates`,
    );
    assert.doesNotMatch(
      source,
      /getAdminClient|SERVICE_ROLE|SUPABASE_SECRET_KEY/u,
      `${file} must stay on the session client so RLS remains the boundary`,
    );
  }
});

test("verified certificate issuance stays on privileged, re-authorizing code", () => {
  const cron = readFileSync("app/api/cron/auto-publish-hours/route.ts", "utf8");
  assert.match(cron, /type:\s*"verified"/u);
  assert.match(cron, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/u);

  const publish = readFileSync("app/projects/[id]/hours/actions.ts", "utf8");
  assert.match(publish, /publish_volunteer_hours_transactional/u);
  assert.doesNotMatch(publish, /\.from\("certificates"\)\s*\.insert/u);
});

test("self-reported hours are written inside the envelope RLS still permits", () => {
  const source = readFileSync("app/api/self-reported-hours/route.ts", "utf8");

  assert.match(source, /type:\s*"self-reported"/u);
  assert.match(source, /user_id:\s*user\.id/u);
  assert.match(source, /creator_id:\s*user\.id/u);
  assert.match(source, /project_id:\s*null/u);
  assert.match(source, /signup_id:\s*null/u);
  assert.match(source, /is_certified:\s*false/u);
  assert.match(source, /check_in_method:\s*"self_report"/u);
});

test("self-reported deletion still re-checks ownership above the policy", () => {
  const source = readFileSync(
    "app/api/self-reported-hours/[id]/route.ts",
    "utf8",
  );

  assert.match(source, /certificate\.user_id !== user\.id/u);
  assert.match(source, /certificate\.type !== "self-reported"/u);
});

test("the certificate policy migration stays inside its blast radius", () => {
  const migration = readFileSync(
    "supabase/migrations/20260811180000_close_certificate_verification_forgery.sql",
    "utf8",
  );

  assert.match(
    migration,
    /DROP POLICY IF EXISTS "certificates_insert_authenticated"/u,
  );
  assert.match(
    migration,
    /DROP POLICY IF EXISTS "certificates_update_authenticated"/u,
  );
  assert.match(
    migration,
    /DROP POLICY IF EXISTS "certificates_delete_authenticated"/u,
  );

  // The organizer entry point, the SELECT policy, and every SECURITY DEFINER
  // ACL are deliberately untouched: this migration closes a write hole beside
  // the canonical path, it does not narrow the canonical path.
  assert.doesNotMatch(
    migration,
    /\bON\s+FUNCTION\b/iu,
    "this migration must not touch any function ACL",
  );
  assert.doesNotMatch(
    migration,
    /DROP POLICY[^\n]*certificates_select_authenticated_owner_or_organizer/u,
    "the SELECT policy is out of scope for this fix",
  );
  assert.doesNotMatch(
    migration,
    /REVOKE[^;]*\bSELECT\b[^;]*ON TABLE public\.certificates/iu,
    "reads stay governed by the untouched SELECT policy",
  );
  assert.match(
    migration,
    /REVOKE[^;]*TRUNCATE[^;]*ON TABLE public\.certificates FROM authenticated/u,
    "TRUNCATE is not reachable by RLS and must be revoked explicitly",
  );
});
