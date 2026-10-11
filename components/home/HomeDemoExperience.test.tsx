import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeDemoExperience } from "./HomeDemoExperience";
import { HomeDemoProjectDetails } from "./HomeDemoProjects";
import { HomeGreeting } from "./HomeGreeting";
import {
  HOME_DEMO_NOTICE,
  HOME_DEMO_PROJECTS,
  HOME_DEMO_SAMPLE_PROFILE,
} from "./home-demo-data";

// Sunday 02:30 UTC, which is still Saturday evening in Los Angeles.
const saturdayNightPacific = new Date("2026-10-11T02:30:00Z");

function count(html: string, pattern: RegExp) {
  return html.match(pattern)?.length ?? 0;
}

describe("HomeGreeting", () => {
  test("the server renders the fallback as one inline span", () => {
    expect(renderToStaticMarkup(<HomeGreeting name="Avery Example" />)).toBe(
      '<span data-slot="home-greeting">Hi there</span>',
    );
  });

  test("a fixed clock and zone render the local weekday, not the UTC one", () => {
    expect(
      renderToStaticMarkup(
        <HomeGreeting
          name="Avery Example"
          now={saturdayNightPacific}
          timeZone="America/Los_Angeles"
        />,
      ),
    ).toContain("Happy Saturday, Avery");
    expect(
      renderToStaticMarkup(
        <HomeGreeting
          name="Avery Example"
          now={saturdayNightPacific.getTime()}
          timeZone="Asia/Tokyo"
        />,
      ),
    ).toContain("Happy Sunday, Avery");
  });

  test("an invalid zone, a missing name, and an email all fall back", () => {
    for (const props of [
      { name: "Avery Example", timeZone: "Invalid/Zone" },
      { name: null, timeZone: "America/Los_Angeles" },
      { name: "avery@example.com", timeZone: "America/Los_Angeles" },
    ]) {
      const html = renderToStaticMarkup(
        <HomeGreeting now={saturdayNightPacific} {...props} />,
      );
      expect(html).toContain(">Hi there<");
      expect(html).not.toContain("@");
    }
  });

  test("span attributes pass through for the page tour", () => {
    expect(
      renderToStaticMarkup(<HomeGreeting data-tour-id="home-greeting" />),
    ).toContain('data-tour-id="home-greeting"');
  });
});

describe("HomeDemoExperience", () => {
  const html = renderToStaticMarkup(<HomeDemoExperience />);

  test("the permanent notice comes first and is not a footer disclaimer", () => {
    expect(count(html, /data-demo-notice="permanent"/gu)).toBe(1);
    expect(html).toContain('role="note"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain(HOME_DEMO_NOTICE.title);
    expect(html).toContain(
      "The numbers and projects on this page are fictional.",
    );
    expect(html).not.toContain("<footer");

    const notice = html.indexOf('data-demo-notice="permanent"');
    const counters = html.indexOf('data-slot="stat-strip"');
    const projects = html.indexOf('data-slot="home-demo-projects"');
    expect(notice).toBeGreaterThan(-1);
    expect(counters).toBeGreaterThan(notice);
    expect(projects).toBeGreaterThan(counters);
  });

  test("each counter starts at its sample value with a visible demo label", () => {
    expect(html).toContain(
      'data-demo-counter="demo-counter-volunteers">5,000</span>',
    );
    expect(html).toContain(
      'data-demo-counter="demo-counter-us-projects">492</span>',
    );
    expect(html).toContain("Sample volunteers<span");
    expect(html).toContain("Sample US projects<span");
    expect(count(html, />Demo<\/span>/gu)).toBe(2);
    expect(count(html, />Made-up number</gu)).toBe(2);
    expect(html).toContain("They do not count real people or projects.");
  });

  test("changing numbers are not announced to screen readers", () => {
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("aria-atomic");
  });

  test("six sample cards, each labelled, located, and described", () => {
    expect(count(html, /data-demo-project="demo-project-/gu)).toBe(6);
    expect(count(html, />Sample project</gu)).toBe(6);
    expect(count(html, /role="heading" aria-level="3"/gu)).toBe(6);
    for (const project of HOME_DEMO_PROJECTS) {
      expect(html).toContain(project.title);
      expect(html).toContain(`${project.city}, ${project.state}`);
      expect(html).toContain(project.role);
      expect(html).toContain(project.schedule);
    }
  });

  test("every card has one native preview button with its own name", () => {
    expect(count(html, /<button\b/gu)).toBe(6);
    expect(count(html, />Preview example<\/button>/gu)).toBe(6);
    const names = [...html.matchAll(/aria-label="(Preview example: [^"]+)"/gu)]
      .map((match) => match[1])
      .filter(Boolean);
    expect(new Set(names).size).toBe(6);
  });

  test("nothing links anywhere and no filled primary button appears", () => {
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("--button-primary-gloss");
    expect(html).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
  });

  test("the built-in greeting falls back on the server", () => {
    expect(html).toContain(
      '<span data-slot="home-greeting">Hi there</span></h2>',
    );
    expect(html).not.toContain(HOME_DEMO_SAMPLE_PROFILE.label);
    expect(html).not.toContain(HOME_DEMO_SAMPLE_PROFILE.name);
  });

  test("showGreeting false leaves the greeting to the page header", () => {
    const embedded = renderToStaticMarkup(
      <HomeDemoExperience showGreeting={false} name="Avery Example" />,
    );
    expect(embedded).not.toContain('data-slot="home-greeting"');
    expect(embedded).not.toContain("Avery");
    expect(count(embedded, /data-demo-notice="permanent"/gu)).toBe(1);
    expect(count(embedded, /data-demo-project="demo-project-/gu)).toBe(6);
  });

  test("a passed name is greeted by first name only", () => {
    const named = renderToStaticMarkup(
      <HomeDemoExperience
        name="Jordan Fixture"
        now={saturdayNightPacific}
        timeZone="America/Los_Angeles"
      />,
    );
    expect(named).toContain("Happy Saturday, Jordan<");
    expect(named).not.toContain("Fixture");
    expect(named).not.toContain(HOME_DEMO_SAMPLE_PROFILE.label);
  });

  test("the sample profile is labelled and replaces any passed name", () => {
    const sample = renderToStaticMarkup(
      <HomeDemoExperience
        sampleProfile
        name="Jordan Fixture"
        now={saturdayNightPacific}
        timeZone="America/Los_Angeles"
      />,
    );
    expect(sample).toContain("Happy Saturday, Avery<");
    expect(sample).toContain(`>${HOME_DEMO_SAMPLE_PROFILE.label}<`);
    expect(sample).not.toContain("Jordan");
  });
});

describe("HomeDemoProjectDetails", () => {
  test("every preview says it does not accept signups and offers no way to", () => {
    for (const project of HOME_DEMO_PROJECTS) {
      const html = renderToStaticMarkup(
        <HomeDemoProjectDetails project={project} />,
      );
      expect(html).toContain("This example does not accept signups.");
      expect(html).toContain('role="note"');
      expect(html).toContain(project.schedule);
      expect(html).toContain(project.role);
      expect(html).toContain("Fictional organizer");
      expect(count(html, /<li>/gu)).toBe(project.tasks.length);
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("href=");
      expect(html).not.toContain("<button");
      expect(html).not.toContain("<form");
    }
  });
});
