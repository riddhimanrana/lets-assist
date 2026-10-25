import assert from "node:assert/strict";
import test from "node:test";
import { ReleaseCheckError } from "../production/app-release-checks.mjs";
import {
  cutoverConfig,
  cutoverFailureMessage,
  jsonRequest,
} from "./cutover-authority.mjs";
import { environment } from "./cutover.fixture.mjs";

test("cutover reports reviewed gate reasons and suppresses unexpected errors", () => {
  assert.equal(
    cutoverFailureMessage(
      new ReleaseCheckError("The repository identity changed."),
    ),
    "The repository identity changed.",
  );
  const secret = "fictional-credential-never-log";
  for (const error of [new Error(secret), secret, { message: secret }])
    assert.doesNotMatch(cutoverFailureMessage(error), /fictional-credential/u);
});

for (const [host, label] of [
  ["api.github.com", "GitHub"],
  ["api.vercel.com", "Vercel"],
])
  test(`${label} HTTP refusal reports only provider and status`, async () => {
    await assert.rejects(
      jsonRequest(
        `https://${host}/fixed?private=fictional-query-secret`,
        "fictional-token-secret",
        {},
        async () => new Response("fictional-response-secret", { status: 403 }),
      ),
      (error) => {
        assert.ok(error instanceof ReleaseCheckError);
        assert.ok(
          error.message.includes(`${label} request refused (HTTP 403)`),
        );
        assert.doesNotMatch(error.message, /fictional|fixed|private=/u);
        return true;
      },
    );
  });

test("provider transport and malformed JSON never expose raw failure data", async () => {
  for (const fetcher of [
    async () => {
      throw new Error("fictional-transport-secret");
    },
    async () => new Response("fictional-json-secret", { status: 200 }),
  ])
    await assert.rejects(
      jsonRequest(
        "https://api.vercel.com/fixed",
        "fictional-token",
        {},
        fetcher,
      ),
      (error) => {
        assert.ok(error instanceof ReleaseCheckError);
        assert.doesNotMatch(cutoverFailureMessage(error), /fictional|fixed/u);
        return true;
      },
    );
});

test("a mismatched Supabase binding identifies the fixed check without its value", () => {
  const env = {
    ...environment(),
    SUPABASE_URL: "https://fictional-secret.example",
  };
  assert.throws(
    () => cutoverConfig(env),
    (error) => {
      assert.match(error.message, /Supabase project or canonical URL/u);
      assert.doesNotMatch(error.message, /fictional-secret/u);
      return true;
    },
  );
});

test("refusal identifies a fixed operation without logging URL or token", async () => {
  await assert.rejects(
    jsonRequest(
      "https://api.github.com/repos/fictional-private/environments/development?token=fictional-secret",
      "fictional-token",
      {},
      async () => new Response("fictional-body", { status: 403 }),
    ),
    (error) => {
      assert.match(error.message, /during environment policy/u);
      assert.doesNotMatch(error.message, /fictional|token=|https:/u);
      return true;
    },
  );
});
