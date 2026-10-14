import assert from "node:assert/strict";
import { test } from "node:test";
import { createCaptureSessions } from "./capture-sessions.mjs";

const password = "FICTIONAL_RUN_PASSWORD_123";
const actor = (n = 1) => ({
  kind: "baseline",
  id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  email: `actor${n}@local.test`,
});
function fixture(overrides = {}) {
  const calls = { signIns: 0, verifications: 0 };
  const sessions = createCaptureSessions({
    password,
    actorLimit: 22,
    createClient(cookies) {
      let current;
      return {
        auth: {
          async signInWithPassword(input) {
            calls.signIns++;
            assert.equal(input.password, password);
            current = actor(Number(input.email.match(/actor(\d+)/u)[1]));
            cookies.setAll([{ name: "fixture-session", value: current.id }]);
            return (
              overrides.signIn?.(current, cookies) ?? {
                data: { user: current, session: { access_token: current.id } },
              }
            );
          },
          async getUser(token) {
            calls.verifications++;
            assert.equal(token, current.id);
            return (
              overrides.verify?.(current, calls) ?? {
                data: { user: current },
              }
            );
          },
        },
      };
    },
  });
  return { sessions, calls };
}

test("266 viewport/theme captures reuse at most 22 actor sign-ins and revalidate each identity", async () => {
  const { sessions, calls } = fixture();
  for (let i = 0; i < 266; i++) {
    const a = actor((i % 22) + 1);
    const result = await sessions.get(a);
    assert.equal(result.accessToken, a.id);
    assert.deepEqual(result.cookies, [
      { name: "fixture-session", value: a.id },
    ]);
  }
  assert.deepEqual(calls, { signIns: 22, verifications: 266 });
  sessions.dispose();
});

test("concurrent captures of one actor share one sign-in", async () => {
  const { sessions, calls } = fixture();
  await Promise.all(Array.from({ length: 4 }, () => sessions.get(actor())));
  assert.deepEqual(calls, { signIns: 1, verifications: 4 });
});

test("a caller cannot change a cached actor's email or reuse returned cookie objects", async () => {
  const { sessions, calls } = fixture();
  const first = await sessions.get(actor());
  first.cookies[0].value = "FOREIGN";
  assert.equal((await sessions.get(actor())).cookies[0].value, actor().id);
  await assert.rejects(
    sessions.get({ ...actor(), email: "foreign@local.test" }),
  );
  assert.equal(calls.signIns, 1);
});

test("invalid or extra actors fail before authenticating", async () => {
  const { sessions, calls } = fixture();
  for (const a of [
    null,
    { ...actor(), kind: "hours" },
    { ...actor(), id: "foreign" },
    { ...actor(), email: "" },
  ]) {
    await assert.rejects(sessions.get(a));
  }
  for (let n = 1; n <= 22; n++) await sessions.get(actor(n));
  await assert.rejects(sessions.get(actor(23)));
  assert.equal(calls.signIns, 22);
});

for (const [name, signIn] of [
  ["sign-in error", () => ({ error: Error("PRIVATE_ERROR"), data: {} })],
  [
    "foreign sign-in identity",
    () => ({ data: { user: actor(2), session: { access_token: "PRIVATE" } } }),
  ],
  ["absent access token", (a) => ({ data: { user: a, session: {} } })],
  [
    "absent cookies",
    (a, cookies) => {
      cookies.setAll([{ name: "fixture-session", value: "" }]);
      return { data: { user: a, session: { access_token: a.id } } };
    },
  ],
]) {
  test(`${name} refuses the capture without disclosing the error`, async () => {
    const { sessions } = fixture({ signIn });
    await assert.rejects(
      sessions.get(actor()),
      /^Error: Exact fictional sign-in failed$/u,
    );
  });
}

for (const [name, verify] of [
  [
    "revoked or expired session",
    () => ({ error: Error("PRIVATE_ERROR"), data: {} }),
  ],
  ["foreign verified identity", () => ({ data: { user: actor(2) } })],
]) {
  test(`${name} fails closed on every capture`, async () => {
    const { sessions, calls } = fixture({ verify });
    await assert.rejects(
      sessions.get(actor()),
      /^Error: Fresh fictional identity failed$/u,
    );
    assert.equal(calls.signIns, 1);
  });
}

test("a later revocation stops a previously accepted actor without another sign-in", async () => {
  const { sessions, calls } = fixture({
    verify: (a, c) =>
      c.verifications > 1
        ? { error: Error("PRIVATE_ERROR"), data: {} }
        : { data: { user: a } },
  });
  await sessions.get(actor());
  await assert.rejects(sessions.get(actor()));
  assert.deepEqual(calls, { signIns: 1, verifications: 2 });
});

test("disposing clears session access and refuses subsequent authentication", async () => {
  const { sessions, calls } = fixture();
  await sessions.get(actor());
  sessions.dispose();
  await assert.rejects(sessions.get(actor()));
  assert.equal(calls.signIns, 1);
});
