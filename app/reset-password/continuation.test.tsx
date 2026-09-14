import { beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

const destination = "/organization/fictional/plugins/dvhs-csf/connect/ABC234";
let submit: (values: Record<string, string>) => Promise<void>;
let requested: FormData | undefined;
let updated: FormData | undefined;
let updateResult: { success?: boolean; error?: { server: string[] } };
let claims: object | null;
const navigations: string[] = [];

mock.module("@hookform/resolvers/zod", () => ({
  zodResolver: () => () => ({}),
}));
mock.module("react-hook-form", () => ({
  useForm: () => ({
    control: {},
    formState: { errors: {} },
    handleSubmit: (callback: typeof submit) => {
      submit = callback;
      return () => {};
    },
    setError: () => {},
    reset: () => {},
  }),
  Controller: ({
    name,
    render,
  }: {
    name: string;
    render: (props: {
      field: { name: string };
      fieldState: { invalid: boolean };
    }) => ReactNode;
  }) => render({ field: { name }, fieldState: { invalid: false } }),
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (path: string) => navigations.push(path) }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims } }) },
  }),
}));
mock.module("@/lib/supabase/client", () => ({
  createClient: () => {
    throw new Error("No auth provider calls in render tests");
  },
}));
mock.module("@/app/login/actions", () => ({
  applyPostLoginAffiliations: () => {},
  signInWithGoogle: () => {},
}));
mock.module("@/app/reset-password/actions", () => ({
  requestPasswordReset: async (formData: FormData) => {
    requested = formData;
    return { success: true };
  },
}));
mock.module("@/app/reset-password/[token]/actions", () => ({
  updatePassword: async (formData: FormData) => {
    updated = formData;
    return updateResult;
  },
}));
mock.module("@/hooks/useBotVerification", () => ({
  useBotVerification: () => ({
    token: "synthetic-challenge",
    reset: () => {},
    isReady: true,
  }),
}));
mock.module("@/hooks/useSecureCheck", () => ({
  useSecureCheck: () => ({ isReady: true }),
}));
mock.module("@/components/ui/turnstile", () => ({
  TurnstileComponent: () => null,
}));
mock.module("@/components/auth/SecureCheckPanel", () => ({
  SecureCheckPanel: () => null,
}));
mock.module("sonner", () => ({
  toast: { error: () => {}, success: () => {} },
}));

const { default: LoginClient } = await import("@/app/login/LoginClient");
const { default: ResetPasswordClient } = await import("./ResetPasswordClient");
const { default: ResetPasswordForm } =
  await import("./[token]/ResetPasswordForm");
const { default: ResetPasswordPage } = await import("./page");
const { default: ResetPasswordTokenPage } = await import("./[token]/page");

beforeEach(() => {
  requested = undefined;
  updated = undefined;
  updateResult = { success: true };
  claims = null;
  navigations.length = 0;
});

test("the rendered forgot-password link retains the class destination", () => {
  const html = renderToStaticMarkup(<LoginClient redirectPath={destination} />);
  expect(html).toContain(
    `/reset-password?redirect=${encodeURIComponent(destination)}`,
  );
});

test("the reset request form and sign-in link retain the class destination", async () => {
  const page = await ResetPasswordPage({
    searchParams: Promise.resolve({ redirect: destination }),
  });
  const html = renderToStaticMarkup(page);
  expect(html).toContain(`/login?redirect=${encodeURIComponent(destination)}`);
  await submit({ email: "fictional@example.test" });
  expect(requested?.get("redirect")).toBe(destination);
  expect(requested?.get("turnstileToken")).toBe("synthetic-challenge");
});

test("the token page returns to class-preserving login only after a successful update", async () => {
  const page = await ResetPasswordTokenPage({
    params: Promise.resolve({ token: "synthetic-code" }),
    searchParams: Promise.resolve({ redirect: destination }),
  });
  renderToStaticMarkup(page);
  updateResult = { error: { server: ["Expired code"] } };
  await submit({ password: "synthetic-new-password" });
  expect(navigations).toEqual([]);
  updateResult = { success: true };
  await submit({ password: "synthetic-new-password" });
  expect(updated?.get("token")).toBe("synthetic-code");
  expect(navigations).toEqual([
    `/login?redirect=${encodeURIComponent(destination)}`,
  ]);
});

for (const unsafe of [
  "https://evil.example/path",
  "//evil.example/path",
  "/\\evil.example/path",
  "%2F%2Fevil.example/path",
]) {
  test(`reset forms reject unsafe continuation ${JSON.stringify(unsafe)}`, async () => {
    const requestHtml = renderToStaticMarkup(
      <ResetPasswordClient redirectPath={unsafe} />,
    );
    expect(requestHtml).toContain('href="/login"');
    await submit({ email: "fictional@example.test" });
    expect(requested?.get("redirect")).toBeNull();
    renderToStaticMarkup(
      <ResetPasswordForm token="synthetic-code" redirectPath={unsafe} />,
    );
    await submit({ password: "synthetic-new-password" });
    expect(navigations).toEqual(["/login"]);
  });
}

test("authenticated users still go to account security", async () => {
  claims = { sub: "synthetic-user" };
  await expect(
    ResetPasswordPage({
      searchParams: Promise.resolve({ redirect: destination }),
    }),
  ).rejects.toThrow("redirect:/account/security");
});

test("reset pages without a continuation keep the ordinary login destination", async () => {
  renderToStaticMarkup(
    await ResetPasswordTokenPage({
      params: Promise.resolve({ token: "synthetic-code" }),
      searchParams: Promise.resolve({}),
    }),
  );
  await submit({ password: "synthetic-new-password" });
  expect(navigations).toEqual(["/login"]);
});

test("server pages discard repeated and external redirect parameters", async () => {
  for (const redirect of [
    [destination, "//evil.example"],
    "https://evil.example/path",
  ]) {
    const requestPage = await ResetPasswordPage({
      searchParams: Promise.resolve({ redirect }),
    });
    expect(renderToStaticMarkup(requestPage)).toContain('href="/login"');
    await submit({ email: "fictional@example.test" });
    expect(requested?.get("redirect")).toBeNull();
    const tokenPage = await ResetPasswordTokenPage({
      params: Promise.resolve({ token: "synthetic-code" }),
      searchParams: Promise.resolve({ redirect }),
    });
    renderToStaticMarkup(tokenPage);
    await submit({ password: "synthetic-new-password" });
    expect(navigations.at(-1)).toBe("/login");
  }
});
