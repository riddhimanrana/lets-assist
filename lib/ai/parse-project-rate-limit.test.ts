import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  PARSE_PROJECT_IP_LIMIT,
  PARSE_PROJECT_USER_LIMIT,
  getRequestIp,
} from "./parse-project-rate-limit-config";

test("derives a bounded client IP while retaining a per-user quota", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    "x-vercel-forwarded-for": "198.51.100.8, 10.0.0.2",
  });
  assert.equal(getRequestIp(headers), "198.51.100.8");
  assert.ok(PARSE_PROJECT_USER_LIMIT > 0);
  assert.ok(PARSE_PROJECT_IP_LIMIT >= PARSE_PROJECT_USER_LIMIT);
});

test("project parser authenticates, validates input, meters, and emits user telemetry", () => {
  const route = readFileSync(
    join(process.cwd(), "app/api/ai/parse-project/route.ts"),
    "utf8",
  );
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260712011038_harden_email_alias_and_ai_rate_limits.sql",
    ),
    "utf8",
  );

  assert.match(route, /getAuthUser\(\{ sensitive: true \}\)/u);
  assert.match(route, /\.max\(4_000\)/u);
  assert.match(route, /consumeParseProjectQuota/u);
  assert.match(route, /status: 429/u);
  assert.match(route, /distinctId: user\.id/u);
  assert.match(route, /parseProjectOutputSchema\.safeParse/u);
  assert.match(route, /status: 502/u);
  assert.match(
    migration,
    /create table if not exists public\.api_rate_limits/u,
  );
  assert.match(migration, /security definer/u);
  assert.match(
    migration,
    /grant execute on function public\.consume_api_rate_limit/u,
  );
});
