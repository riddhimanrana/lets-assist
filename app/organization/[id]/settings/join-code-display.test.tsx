import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
mock.module("../../create/actions", () => ({
  regenerateJoinCode: async () => {
    throw new Error("Rendering must not regenerate a code");
  },
}));
const { default: JoinCodeAdminDisplay } =
  await import("./JoinCodeAdminDisplay");

test("organization join settings expose separate code and membership link controls", () => {
  const html = renderToStaticMarkup(
    <JoinCodeAdminDisplay
      organizationId="fictional-organization"
      joinCode="654321"
    />,
  );
  expect(html).toContain('aria-label="Copy join code"');
  expect(html).toContain("Copy invitation link");
  expect(html).toContain('value="654321"');
  expect(html).not.toContain("staff_token");
});
