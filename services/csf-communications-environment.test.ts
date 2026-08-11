import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { resolveCsfCommunicationsEnvironment } =
  await import("./csf-communications-environment");

const savedVercel = process.env.VERCEL;

afterEach(() => {
  if (savedVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = savedVercel;
});

describe("CSF communications environment coordinate", () => {
  test("uses the canonical Supabase project ref for hosted backends", () => {
    expect(
      resolveCsfCommunicationsEnvironment(
        "https://abcdefghijklmnopqrst.supabase.co",
      ),
    ).toBe("abcdefghijklmnopqrst");
  });

  test("normalizes loopback stacks to the local coordinate", () => {
    expect(resolveCsfCommunicationsEnvironment("http://127.0.0.1:55321")).toBe(
      "local",
    );
    expect(resolveCsfCommunicationsEnvironment("http://localhost:54321")).toBe(
      "local",
    );
  });

  test("fails closed for an invalid or noncanonical remote URL", () => {
    expect(() => resolveCsfCommunicationsEnvironment("not a url")).toThrow();
    expect(() =>
      resolveCsfCommunicationsEnvironment("https://database.example.test"),
    ).toThrow();
  });

  test("a hosted deployment may not silently fall back to local", () => {
    process.env.VERCEL = "1";
    expect(() => resolveCsfCommunicationsEnvironment(undefined)).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL",
    );
  });
});
