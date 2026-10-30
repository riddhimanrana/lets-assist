/**
 * linkAnonymousToNewAccount with every Supabase and Next dependency mocked.
 * No real signup, email, session or RPC happens. Proves only the action's
 * own branching: a signup without a session must return before the guest
 * attendance transfer.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

type SignUpResult = {
  data: { user: { id: string } | null; session: object | null };
  error: { message: string } | null;
};
let signUpResult: SignUpResult;
const signUpCalls: unknown[] = [];
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let rpcError: { code: string } | null = null;

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signUp: async (input: unknown) => {
        signUpCalls.push(input);
        return signUpResult;
      },
    },
  }),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { error: rpcError };
    },
  }),
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  requireAuth: async () => {
    throw new Error("not used");
  },
}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("@/app/signup/canonical-auth-request", () => ({
  runOnCanonicalAuthOrigin: async (
    _path: string,
    run: (origin: string) => Promise<unknown>,
  ) => run("https://example.test"),
}));

const { linkAnonymousToNewAccount } = await import("./actions");

const GUEST = "00000000-0000-4000-8000-0000000000a1";
const TOKEN = "fictional-guest-token-with-enough-length-0123456789";

const create = () =>
  linkAnonymousToNewAccount(
    GUEST,
    TOKEN,
    "guest@example.test",
    "fictional-pass-123",
    "Fictional Guest",
  );

beforeEach(() => {
  signUpCalls.length = 0;
  rpcCalls.length = 0;
  rpcError = null;
});

describe("new account linking", () => {
  test("no session: account created, verification required, nothing transferred", async () => {
    signUpResult = {
      data: { user: { id: "new-user" }, session: null },
      error: null,
    };
    expect(await create()).toEqual({ requiresEmailVerification: true });
    expect(signUpCalls).toHaveLength(1);
    expect(rpcCalls).toEqual([]);
    // The confirmation email returns to this exact guest profile to link.
    const redirect = (
      signUpCalls[0] as { options: { emailRedirectTo: string } }
    ).options.emailRedirectTo;
    const after = decodeURIComponent(
      new URL(redirect).searchParams.get("redirectAfterAuth") ?? "",
    );
    expect(after).toBe(
      `/anonymous/${GUEST}?token=${encodeURIComponent(TOKEN)}&link=1`,
    );
  });

  test("with a session: the guest attendance is linked to the new account", async () => {
    signUpResult = {
      data: { user: { id: "new-user" }, session: { access_token: "x" } },
      error: null,
    };
    expect(await create()).toEqual({ requiresEmailVerification: false });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("link_guest_attendance_account");
    expect(rpcCalls[0].args).toMatchObject({
      p_anonymous_id: GUEST,
      p_user_id: "new-user",
    });
  });

  test("a failed transfer after signup says the account exists but is not linked", async () => {
    signUpResult = {
      data: { user: { id: "new-user" }, session: { access_token: "x" } },
      error: null,
    };
    rpcError = { code: "42501" };
    const result = await create();
    expect(result.error).toContain("Account created but linking failed");
    expect(result.requiresEmailVerification).toBeUndefined();
  });

  test("signup errors never reach the transfer", async () => {
    signUpResult = {
      data: { user: null, session: null },
      error: { message: "User already exists" },
    };
    expect((await create()).error).toContain("already exists");
    expect(rpcCalls).toEqual([]);
  });

  test("a short password is refused before signup", async () => {
    const result = await linkAnonymousToNewAccount(
      GUEST,
      TOKEN,
      "guest@example.test",
      "short",
      "Fictional Guest",
    );
    expect(result.error).toContain("at least 8");
    expect(signUpCalls).toEqual([]);
  });
});
