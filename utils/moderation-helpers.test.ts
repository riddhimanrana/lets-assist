import { afterEach, expect, test } from "bun:test";
import {
  checkOffensiveLanguage,
  MAX_LOCAL_CONTENT_LENGTH,
} from "./moderation-helpers";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("empty and ordinary text need no external service", async () => {
  let outboundCalls = 0;
  globalThis.fetch = Object.assign(
    () => {
      outboundCalls++;
      throw new Error("No external content check is allowed.");
    },
    { preconnect: originalFetch.preconnect },
  );
  for (const text of ["", "  \n", "Volunteer at the community garden"]) {
    expect(await checkOffensiveLanguage(text)).toEqual({ isProfane: false });
  }
  expect((await checkOffensiveLanguage("shit")).isProfane).toBe(true);
  expect(outboundCalls).toBe(0);
});

test("matching respects names and Unicode letter boundaries", async () => {
  for (const text of ["Scunthorpe", "toshitchowda", "éshit", "shit\u0301"]) {
    expect((await checkOffensiveLanguage(text)).isProfane).toBe(false);
  }
  for (const text of ["SHIT", "mr_shit", "shit123", "(shit)", "ｓｈｉｔ"]) {
    expect((await checkOffensiveLanguage(text)).isProfane).toBe(true);
  }
});

test("invalid and oversized input is not reported as clean content", async () => {
  for (const text of [null, 12, {}, "a".repeat(MAX_LOCAL_CONTENT_LENGTH + 1)]) {
    await expect(checkOffensiveLanguage(text as string)).rejects.toThrow(
      "Content is not valid",
    );
  }
  expect(
    await checkOffensiveLanguage("a".repeat(MAX_LOCAL_CONTENT_LENGTH)),
  ).toEqual({ isProfane: false });
});
