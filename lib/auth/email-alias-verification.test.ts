import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  EMAIL_ALIAS_RESEND_COOLDOWN_MS,
  emailAliasHashesMatch,
  generateEmailAliasVerificationCode,
  getEmailAliasResendDelayMs,
  hashEmailAliasVerificationCode,
  normalizeEmailAlias,
} from "./email-alias-verification";

const SECRET = "test-only-email-alias-verification-secret-32-bytes";

test("generates six-digit cryptographic codes and stores only a keyed hash", () => {
  for (let index = 0; index < 25; index += 1) {
    assert.match(generateEmailAliasVerificationCode(), /^\d{6}$/u);
  }

  const hash = hashEmailAliasVerificationCode("123456", SECRET);
  assert.equal(hash.includes("123456"), false);
  assert.equal(
    emailAliasHashesMatch(
      hash,
      hashEmailAliasVerificationCode("123456", SECRET),
    ),
    true,
  );
  assert.equal(
    emailAliasHashesMatch(
      hash,
      hashEmailAliasVerificationCode("654321", SECRET),
    ),
    false,
  );
});

test("normalizes aliases and enforces resend cooldown", () => {
  assert.equal(
    normalizeEmailAlias(" Person@Example.COM "),
    "person@example.com",
  );

  const now = Date.UTC(2026, 6, 11, 12, 0, 0);
  assert.equal(
    getEmailAliasResendDelayMs(new Date(now - 1_000).toISOString(), now),
    EMAIL_ALIAS_RESEND_COOLDOWN_MS - 1_000,
  );
  assert.equal(
    getEmailAliasResendDelayMs(
      new Date(now - EMAIL_ALIAS_RESEND_COOLDOWN_MS).toISOString(),
      now,
    ),
    0,
  );
});

test("alias writes are server-only and verification is bounded in SQL", () => {
  const actions = readFileSync(
    join(process.cwd(), "app/account/email-actions.ts"),
    "utf8",
  );
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260712021110_move_email_alias_challenges_out_of_verified_aliases.sql",
    ),
    "utf8",
  );
  const attendanceActions = readFileSync(
    join(process.cwd(), "app/attend/[projectId]/actions.ts"),
    "utf8",
  );
  const confirmRoute = readFileSync(
    join(process.cwd(), "app/auth/confirm/route.ts"),
    "utf8",
  );

  assert.match(
    actions,
    /getAuthUser\(\{ sensitive: true, checkMfa: true \}\)/u,
  );
  assert.match(actions, /verify_user_email_alias/u);
  assert.match(actions, /issue_user_email_alias_verification/u);
  assert.match(actions, /discard_user_email_alias_verification/u);
  assert.match(actions, /syncPrimaryUserEmail/u);
  assert.doesNotMatch(actions, /\.from\("profiles"\)[\s\S]*existingProfile/u);
  assert.doesNotMatch(
    actions,
    /\.from\("user_emails"\)[\s\S]*verification_token_hash/u,
  );
  assert.doesNotMatch(actions, /verification_token:\s*token[,\s]/u);
  assert.doesNotMatch(actions, /primary_email:/u);
  assert.match(
    migration,
    /CREATE TABLE public\.email_alias_verification_challenges/u,
  );
  assert.match(migration, /UNIQUE \(user_id, email\)/u);
  assert.match(
    migration,
    /DELETE FROM public\.user_emails\s+WHERE verified_at IS NULL/u,
  );
  assert.match(migration, /ALTER COLUMN verified_at SET NOT NULL/u);
  assert.match(migration, /DROP COLUMN verification_token/u);
  assert.match(migration, /FROM auth\.users AS users/u);
  assert.match(migration, /private\.protect_profile_auth_email/u);
  assert.match(migration, /public\.sync_primary_user_email/u);
  assert.match(migration, /user_emails_one_primary_per_user_idx/u);
  assert.match(migration, /v_attempts >= 5/u);
  assert.match(migration, /interval '15 minutes'/u);
  assert.match(
    migration,
    /aliases\.verification_expires_at > clock_timestamp\(\)/u,
  );
  assert.match(attendanceActions, /\.not\("verified_at", "is", null\)/u);
  assert.match(confirmRoute, /syncPrimaryUserEmail/u);
});
