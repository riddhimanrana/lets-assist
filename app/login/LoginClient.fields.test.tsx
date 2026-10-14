import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as turnstile from "@/components/ui/turnstile";

mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/app/login/actions", () => ({
  applyPostLoginAffiliations: async () => ({}),
  signInWithGoogle: async () => ({}),
}));
mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));
mock.module("@/components/ui/turnstile", () => ({
  ...turnstile,
  TurnstileComponent: () => null,
}));
const { default: LoginClient } = await import("./LoginClient");

// The fixture notice replaces only the Google button. The fields are shared.
const html = renderToStaticMarkup(<LoginClient localFixtureMode />);
function inputTag(id: string) {
  return html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`, "u"))?.[0];
}

test("the email field is an email input that offers the saved address", () => {
  const email = inputTag("email");
  expect(email).toBeDefined();
  expect(email).toContain('type="email"');
  expect(email).toMatch(/\bautocomplete="email"/iu);
  expect(html).toContain('for="email"');
});

test("the password field asks for the current password", () => {
  const password = inputTag("password");
  expect(password).toBeDefined();
  expect(password).toContain('type="password"');
  expect(password).toMatch(/\bautocomplete="current-password"/iu);
  expect(html).toContain('for="password"');
});

test("the schema, not the browser, still reports an invalid email", () => {
  expect(html).toMatch(/<form\b[^>]*\bnovalidate\b/iu);
});
