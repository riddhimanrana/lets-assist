import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LandingLazySections } from "../LandingLazySections";
import ComparisonSection from "./ComparisonSection";
import VolunteerJourneySection from "./VolunteerJourneySection";

// The real components render here, with the real motion library, so an
// entrance that starts hidden shows up as the inline style a browser would
// receive before any script runs.
function hiddenFirstRenderStyles(markup: string) {
  return [...markup.matchAll(/style="([^"]*)"/gu)]
    .map((match) => match[1])
    .filter(
      (style) =>
        /(?:^|;)opacity:\s*0(?:;|$)/u.test(style) ||
        /scale(?:X|Y)?\(0(?:,\s*0)?\)/u.test(style) ||
        /(?:^|;)(?:display:\s*none|visibility:\s*hidden)(?:;|$)/u.test(style),
    );
}

function readableText(markup: string) {
  return markup
    .replace(/<[^>]+>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ");
}

function linkDestination(markup: string, name: string) {
  for (const [, attributes, content] of markup.matchAll(
    /<a\s([^>]*)>([\s\S]*?)<\/a>/gu,
  )) {
    if (readableText(content).trim() === name) {
      return /href="([^"]*)"/u.exec(attributes)?.[1];
    }
  }
  return undefined;
}

describe("landing first-response visibility", () => {
  test("the final signup and demo actions are visible in the first response", () => {
    const html = renderToStaticMarkup(createElement(LandingLazySections));
    expect(linkDestination(html, "Create a project")).toBe(
      "/signup?redirect=%2Fprojects%2Fcreate",
    );
    expect(readableText(html)).toContain("Play demo video");
    expect(hiddenFirstRenderStyles(html)).toEqual([]);
    expect(html).not.toContain("<iframe");
  });

  test("comparison copy, table and first mock panel start visible without JavaScript", () => {
    const html = renderToStaticMarkup(createElement(ComparisonSection));
    const text = readableText(html);
    for (const copy of [
      "One workflow for",
      "Let's Assist is built for volunteer hours.",
      "QR check-in and check-out",
      "Explore opportunities",
      "Volunteer Signup Sheet",
    ]) {
      expect(text).toContain(copy);
    }
    expect(hiddenFirstRenderStyles(html)).toEqual([]);
  });

  test("journey heading, certificate preview and all step cards start visible without JavaScript", () => {
    const html = renderToStaticMarkup(createElement(VolunteerJourneySection));
    const text = readableText(html);
    for (const copy of [
      "From sign-up to certificate",
      "Browse feed",
      "Sign up & confirm",
      "QR check-in/out",
      "Track progress",
      "Get a certificate",
      "Certificate of Volunteer Service",
      "Alex Morgan",
    ]) {
      expect(text).toContain(copy);
    }
    expect(hiddenFirstRenderStyles(html)).toEqual([]);
  });

  test("the organization section is readable around a compact demo fallback", () => {
    // Outside a Next request next/dynamic renders each `loading` fallback, so
    // this is the markup a browser holds while the client-only demo is absent.
    // The two tests above render the server-rendered sections directly.
    const html = renderToStaticMarkup(createElement(LandingLazySections));
    const section = /<section id="org-tooling"[\s\S]*?<\/section>/u.exec(
      html,
    )?.[0];
    expect(section).toBeDefined();
    const text = readableText(section ?? "");
    for (const copy of [
      "One workspace for your team",
      "Plan the shifts",
      "Review real attendance",
      "Issue service proof",
      "Add organization tools",
      "Interactive organization demo",
    ]) {
      expect(text).toContain(copy);
    }
    expect(section).toMatch(/<h2[\s>]/u);
    expect(linkDestination(section ?? "", "Create a project")).toBe(
      "/signup?redirect=%2Fprojects%2Fcreate",
    );
    expect(hiddenFirstRenderStyles(section ?? "")).toEqual([]);
  });
});
