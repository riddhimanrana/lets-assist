import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectDetailsHeader } from "./ProjectDetailsHeader";

const render = (headingLevel?: 1 | 2) =>
  renderToStaticMarkup(
    <ProjectDetailsHeader
      title="Fictional river cleanup"
      status="upcoming"
      when="Mar 14, 2099"
      location="Community hall"
      hostName="Fictional Food Bank"
      hostIsOrganization
      hostVerified
      primaryAction={<button type="button">Sign up</button>}
      onShare={() => {}}
      onReport={() => {}}
      headingLevel={headingLevel}
    />,
  );

describe("project details header heading", () => {
  test("a real project page names the project in one h1", () => {
    for (const html of [render(), render(1)]) {
      expect(html.match(/<h1\b/gu)).toHaveLength(1);
      expect(html).not.toMatch(/<h2\b/u);
      expect(html).toMatch(/<h1\b[^>]*>Fictional river cleanup<\/h1>/u);
    }
    expect(render(1)).toBe(render());
  });

  test("an embedded header moves the name to an h2 and changes nothing else", () => {
    const html = render(2);
    expect(html.match(/<h2\b/gu)).toHaveLength(1);
    expect(html).not.toMatch(/<h1\b/u);
    expect(html).toMatch(/<h2\b[^>]*>Fictional river cleanup<\/h2>/u);
    expect(html).toBe(render().replace(/(<\/?)h1\b/gu, "$1h2"));

    // Status, facts and actions are all still there at either level.
    for (const copy of [
      "Mar 14, 2099",
      "Community hall",
      "Fictional Food Bank",
      "Sign up",
      'aria-label="Share project"',
      "More options",
      'aria-label="Verified organization"',
    ]) {
      expect(html).toContain(copy);
    }
  });
});

// Source check only. The rendered demo is covered by the hero first-render
// test in app/(landing)/_components/landing-accessibility.test.tsx.
describe("project details heading level", () => {
  const read = (file: string) =>
    readFileSync(resolve(import.meta.dir, file), "utf8");

  test("follows demoMode, which the real project route never passes", () => {
    expect(read("ProjectDetails.tsx")).toContain(
      "headingLevel={demoMode ? 2 : 1}",
    );
    expect(read("ProjectDetails.tsx")).toContain("demoMode = false,");
    expect(read("ProjectClient.tsx")).not.toContain("demoMode");
    expect(read("ProjectClient.tsx")).not.toContain("headingLevel");
  });
});
