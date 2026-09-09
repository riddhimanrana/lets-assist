import { beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

const configurations: Array<{
  global?: { headers?: Record<string, string> };
  cookies: { getAll(): unknown };
}> = [];
const cookieValues = [{ name: "fictional-session", value: "fictional-value" }];
mock.module("next/headers", () => ({
  cookies: async () => ({ getAll: () => cookieValues, set: () => {} }),
}));
mock.module("@supabase/ssr", () => ({
  createServerClient: (
    _url: unknown,
    _key: unknown,
    options: (typeof configurations)[number],
  ) => {
    configurations.push(options);
    return {};
  },
}));
const { createClient } = await import("./server");
const create = createClient;
const token = "10000000-0000-4000-8000-000000000001";

beforeEach(() => configurations.splice(0));

test("invitation reads carry the exact token and retain request cookies", async () => {
  await create({ invitationToken: token });
  expect(configurations[0].global?.headers?.["x-invitation-token"]).toBe(token);
  expect(configurations[0].cookies.getAll()).toEqual(cookieValues);
});

test("invitation capability never leaks into the next ordinary client", async () => {
  await create({ invitationToken: token });
  await create();
  expect(
    configurations[1].global?.headers?.["x-invitation-token"],
  ).toBeUndefined();
});

test("concurrent invitation clients keep separate capabilities", async () => {
  const other = "20000000-0000-4000-8000-000000000002";
  await Promise.all([
    create({ invitationToken: token }),
    create({ invitationToken: other }),
  ]);
  expect(
    configurations
      .map((value) => value.global?.headers?.["x-invitation-token"])
      .sort(),
  ).toEqual([token, other]);
});

test("malformed invitation tokens fail before creating a database client", async () => {
  for (const invitationToken of [
    "",
    "not-a-token",
    `${token}\r\nOther: value`,
  ]) {
    await expect(create({ invitationToken })).rejects.toThrow(
      "Invalid invitation token",
    );
  }
  expect(configurations).toHaveLength(0);
});

test("both invitation lookup and acceptance request the scoped token client", () => {
  const base = `${process.cwd()}/app/organization/[id]/admin/server`;
  const lookup = readFileSync(`${base}/invitations.ts`, "utf8").split(
    "export async function getInvitationByToken",
  )[1];
  const acceptance = readFileSync(`${base}/acceptance.ts`, "utf8");
  for (const source of [lookup, acceptance]) {
    expect(source).toContain("createClient({ invitationToken: token })");
    expect(source).toContain("isInvitationToken(token)");
    expect(source).toContain('.eq("token", token)');
  }
  expect(acceptance).toContain("signedInEmail !== invitedEmail");
});
