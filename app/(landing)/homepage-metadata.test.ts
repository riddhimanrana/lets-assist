import { expect, test } from "bun:test";

import { HERO_HEADLINE_TEXT } from "./homepage-copy";
import { homepageMetadata } from "./homepage-metadata";

test("the homepage document and share titles match the visible tagline", () => {
  const title = "Let's Assist: The modern way to do volunteering";
  expect(title).toBe(`Let's Assist: ${HERO_HEADLINE_TEXT}`);
  expect(homepageMetadata.title).toEqual({ absolute: title });
  expect(homepageMetadata.openGraph?.title).toBe(title);
  expect(homepageMetadata.twitter?.title).toBe(title);
});
