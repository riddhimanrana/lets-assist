import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PROJECT_FEED_VISIBILITY_RULES,
  ProjectFeedEmpty,
  type ProjectFeedEmptyState,
} from "./ProjectFeedEmpty";

const STATES: ProjectFeedEmptyState[] = [
  "empty",
  "filtered",
  "restricted",
  "error",
];

function render(
  state: ProjectFeedEmptyState,
  callbacks: { onClear?: () => void; onRetry?: () => void } = {
    onClear: () => {},
    onRetry: () => {},
  },
) {
  return renderToStaticMarkup(
    <ProjectFeedEmpty state={state} {...callbacks} />,
  );
}

function count(html: string, pattern: RegExp) {
  return html.match(pattern)?.length ?? 0;
}

describe("ProjectFeedEmpty", () => {
  test("every state names itself and offers at most one action", () => {
    for (const state of STATES) {
      const html = render(state);
      expect(html).toContain(`data-feed-state="${state}"`);
      expect(count(html, /<button\b/gu) + count(html, /<a\b/gu)).toBe(1);
    }
  });

  test("the four states have four different titles", () => {
    const titles = STATES.map(
      (state) =>
        render(state).match(/data-slot="empty-title"[^>]*>([^<]+)</u)?.[1],
    );
    expect(new Set(titles).size).toBe(4);
    expect(titles).not.toContain(undefined);
  });

  test("the empty state explains visibility and links to organizations", () => {
    const html = render("empty");
    expect(html).toContain("Published public projects with upcoming dates");
    expect(html).toContain("open spots appear here");
    expect(html).toContain("Unlisted projects open from the link");
    expect(html).toContain("Organization-only projects are visible to that");
    expect(html).toContain('href="/organization"');
    expect(html).toContain("Explore organizations");
    expect(count(html, /<li>/gu)).toBe(PROJECT_FEED_VISIBILITY_RULES.length);
  });

  test("the empty state never claims the platform has no projects", () => {
    const html = render("empty");
    expect(html).toContain("Explore an organization");
    expect(html).not.toMatch(/no projects (?:exist|are available|yet)/iu);
    expect(html).not.toMatch(/there are no projects/iu);
  });

  test("no state mentions trusted members, admins, or a signup link", () => {
    for (const state of STATES) {
      const html = render(state);
      expect(html).not.toMatch(/trusted|admin|verified/iu);
      expect(html).not.toMatch(/href="[^"]*(?:signup|login|create)/iu);
      const hrefs = [...html.matchAll(/href="([^"]*)"/gu)].map(
        (match) => match[1],
      );
      expect(hrefs.every((href) => href === "/organization")).toBe(true);
    }
  });

  test("the filtered state clears filters and does not list visibility rules", () => {
    const html = render("filtered");
    expect(html).toContain("No projects match your filters");
    expect(html).toContain("Clear all filters");
    expect(html).not.toContain("Unlisted projects");
    expect(html).not.toContain("<a ");
  });

  test("the filtered state without a handler shows no dead button", () => {
    const html = render("filtered", {});
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Clear all filters");
  });

  test("the restricted state says access is the problem and keeps the rules", () => {
    const html = render("restricted");
    expect(html).toContain("You can&#x27;t view this feed right now");
    expect(html).toContain("Sign in again");
    expect(html).toContain("Organization-only projects are visible to that");
    expect(html).not.toContain("Try again");
    expect(html).not.toContain('role="alert"');
  });

  test("an error does not look or read like an empty feed", () => {
    const html = render("error");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn&#x27;t load projects");
    expect(html).toContain("try loading projects again");
    expect(html).toContain("Try again");
    expect(html).toContain("border-solid");
    expect(html).toContain("border-destructive/30");
    expect(html).not.toContain("border-dashed");
    expect(html).toContain("text-destructive");
    expect(html).not.toContain("Explore organizations");
    expect(html).not.toContain("Unlisted projects");
  });

  test("only the error state is an alert with a solid border", () => {
    for (const state of STATES.filter((entry) => entry !== "error")) {
      const html = render(state);
      expect(html).not.toContain('role="alert"');
      expect(html).toContain("border-dashed");
      expect(html).not.toContain("border-destructive/30");
      expect(html).not.toContain("bg-destructive/10");
    }
  });

  test("an error without a retry handler shows no dead button", () => {
    const html = render("error", {});
    expect(html).not.toContain("<button");
    expect(html).toContain("Couldn&#x27;t load projects");
  });

  test("it is one surface with no card inside it", () => {
    for (const state of STATES) {
      const html = render(state);
      expect(count(html, /data-slot="empty"/gu)).toBe(1);
      expect(html).not.toContain('data-slot="card"');
    }
  });

  test("extra attributes reach the root element", () => {
    const html = renderToStaticMarkup(
      <ProjectFeedEmpty state="empty" data-tour-id="home-project-list" />,
    );
    expect(html).toContain('data-tour-id="home-project-list"');
  });
});
