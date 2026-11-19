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
  TurnstileComponent: () => (
    <iframe title="Secure check fixture" width="300" height="65" />
  ),
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

test("the login secure-check frame matches the fields and can scroll without shrinking the widget", () => {
  expect(html).toMatch(/<div class="[^"]*max-w-none[^"]*rounded-xl[^"]*">/u);
  expect(html).toContain('class="w-full min-w-0 overflow-x-auto"');
  expect(html).toContain('class="mx-auto w-max px-2 py-1"');
  expect(html).toContain(
    '<iframe title="Secure check fixture" width="300" height="65">',
  );
});
