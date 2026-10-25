import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let refreshes = 0;
mock.module("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {
      refreshes += 1;
    },
  }),
}));

const { ReadLoadError } = await import("./ReadLoadError");

test("announces the failure and offers one idle, explicit retry", () => {
  const html = renderToStaticMarkup(
    <ReadLoadError title="We couldn't load your drafts" />,
  );

  expect(html).toContain('role="alert"');
  expect(html).toContain('aria-busy="false"');
  expect(html).toContain("We couldn&#x27;t load your drafts");
  expect(html).toContain("Check your connection and try again.");
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain('type="button"');
  expect(html).toContain(">Try again</button>");
  expect(html).not.toMatch(/ disabled=""| aria-disabled="true"/);
  expect(html).not.toContain("Trying again");
});

test("rendering never refreshes on its own", () => {
  refreshes = 0;
  renderToStaticMarkup(<ReadLoadError title="We couldn't load this project" />);
  expect(refreshes).toBe(0);
});
