import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

function runProbe(assertions: string) {
  const result = spawnSync(
    process.execPath,
    [
      "--eval",
      `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      mock.module("server-only", () => ({}));
      let mode = "active", freshCalls = 0, pendingCalls = 0, outboundCalls = 0;
      const user = { id: "fictional-content-check", email: "content@local.test" };
      mock.module("./lib/supabase/server", () => ({ createClient: async () => ({
        auth: {
          getClaims: async () => { throw new Error("Fresh authentication required."); },
          getUser: async () => {
            freshCalls++;
            if (mode === "throw") throw new Error("private-provider-diagnostic");
            return { data: { user: mode === "signed-out" ? null : user }, error: mode === "auth-error" ? { message: "private-provider-diagnostic" } : null };
          },
          mfa: {
            getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null }),
            listFactors: async () => ({ data: { all: [] }, error: null }),
          },
        },
        rpc: async (name) => {
          assert.equal(name, "account_deletion_pending"); pendingCalls++;
          return { data: mode === "deleting", error: mode === "guard-error" ? { message: "private-provider-diagnostic" } : null };
        },
      }) }));
      globalThis.fetch = async () => { outboundCalls++; throw new Error("External request refused."); };
      const { checkProfanity } = await import("./app/projects/create/server/validation");
      const valid = { title: "Community garden", location: "Local venue", description: "Help volunteers plant flowers." };
      ${assertions}
      assert.equal(outboundCalls, 0);
      `,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  expect(result.status).toBe(0);
}

test("content checking requires fresh auth and a clear deletion guard", () => {
  runProbe(`
    for (mode of ["signed-out", "auth-error", "deleting", "guard-error", "throw"]) {
      const result = await checkProfanity(valid);
      assert.equal(result.success, false);
      assert.equal(typeof result.error, "string");
      assert.equal(JSON.stringify(result).includes("private-provider-diagnostic"), false);
    }
    assert.equal(freshCalls, 5);
    assert.equal(pendingCalls, 2);
  `);
});

test("the action accepts only bounded project content fields", () => {
  runProbe(`
    for (const input of [null, {}, { ...valid, title: "" }, { ...valid, title: [] },
      { ...valid, title: "a".repeat(126) }, { ...valid, location: "a".repeat(251) },
      { ...valid, description: "a".repeat(2001) }, { ...valid, extra: "unexpected" }]) {
      assert.equal((await checkProfanity(input)).success, false);
    }
    assert.equal((await checkProfanity({title: "a".repeat(125), location: "a".repeat(250), description: "a".repeat(2000)})).success, true);
  `);
});

test("local field results preserve the action response without sending text", () => {
  runProbe(`
    assert.deepEqual(await checkProfanity(valid), {
      success: true, hasProfanity: false,
      fieldResults: { title: { isProfanity: false }, location: { isProfanity: false }, description: { isProfanity: false } },
    });
    const flagged = await checkProfanity({ ...valid, title: "shit123", description: "ｓｈｉｔ" });
    assert.equal(flagged.success, true);
    assert.equal(flagged.hasProfanity, true);
    assert.equal(flagged.fieldResults.title.isProfanity, true);
    assert.equal(flagged.fieldResults.description.isProfanity, true);
    assert.equal(flagged.fieldResults.location.isProfanity, false);
    assert.equal(freshCalls, 2);
    assert.equal(pendingCalls, 2);
  `);
});
