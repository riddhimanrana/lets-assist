import { describe, expect, it } from "bun:test";

import {
  SECURE_CHECK_TIMEOUT_MS,
  SECURE_CHECK_UNAVAILABLE_COPY,
  hasSecureCheckTimedOut,
  isSecureCheckBlockingSubmit,
  resolveSecureCheckPhase,
  secureCheckWatchdogDelayMs,
  shouldReinjectTurnstileScript,
} from "./secure-check";

describe("resolveSecureCheckPhase", () => {
  it("waits while the widget is still initializing", () => {
    expect(resolveSecureCheckPhase({ isReady: false })).toBe("loading");
  });

  it("reports ready once the widget loads", () => {
    expect(resolveSecureCheckPhase({ isReady: true })).toBe("ready");
  });

  it("stops waiting once the bounded wait expires", () => {
    expect(resolveSecureCheckPhase({ isReady: false, timedOut: true })).toBe(
      "unavailable",
    );
  });

  it("stops waiting as soon as the widget errors before loading", () => {
    expect(resolveSecureCheckPhase({ isReady: false, hasErrored: true })).toBe(
      "unavailable",
    );
  });

  it("keeps a loaded widget ready when it errors afterwards", () => {
    expect(
      resolveSecureCheckPhase({
        isReady: true,
        hasErrored: true,
        timedOut: true,
      }),
    ).toBe("ready");
  });
});

describe("hasSecureCheckTimedOut", () => {
  it("uses a ten second default budget", () => {
    expect(SECURE_CHECK_TIMEOUT_MS).toBe(10_000);
    expect(hasSecureCheckTimedOut(9_999)).toBe(false);
    expect(hasSecureCheckTimedOut(10_000)).toBe(true);
    expect(hasSecureCheckTimedOut(25_000)).toBe(true);
  });

  it("honors a custom budget", () => {
    expect(hasSecureCheckTimedOut(7_999, 8_000)).toBe(false);
    expect(hasSecureCheckTimedOut(8_000, 8_000)).toBe(true);
  });

  it("never times out on non-finite input", () => {
    expect(hasSecureCheckTimedOut(Number.NaN)).toBe(false);
    expect(hasSecureCheckTimedOut(1_000, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("secureCheckWatchdogDelayMs", () => {
  it("schedules the full budget for a fresh attempt", () => {
    expect(secureCheckWatchdogDelayMs({ isReady: false })).toBe(
      SECURE_CHECK_TIMEOUT_MS,
    );
  });

  it("subtracts time already spent waiting", () => {
    expect(
      secureCheckWatchdogDelayMs({ isReady: false, elapsedMs: 4_000 }),
    ).toBe(6_000);
  });

  it("does not schedule anything once the check settles", () => {
    expect(secureCheckWatchdogDelayMs({ isReady: true })).toBeNull();
    expect(
      secureCheckWatchdogDelayMs({ isReady: false, hasErrored: true }),
    ).toBeNull();
    expect(
      secureCheckWatchdogDelayMs({ isReady: false, elapsedMs: 12_000 }),
    ).toBeNull();
  });

  it("clamps negative elapsed time", () => {
    expect(
      secureCheckWatchdogDelayMs({
        isReady: false,
        elapsedMs: -5_000,
        timeoutMs: 8_000,
      }),
    ).toBe(8_000);
  });
});

describe("isSecureCheckBlockingSubmit", () => {
  it("blocks only while the check is still settling", () => {
    expect(isSecureCheckBlockingSubmit("loading")).toBe(true);
    expect(isSecureCheckBlockingSubmit("ready")).toBe(false);
    expect(isSecureCheckBlockingSubmit("unavailable")).toBe(false);
  });
});

describe("shouldReinjectTurnstileScript", () => {
  it("drops a script tag that never produced the Turnstile global", () => {
    expect(
      shouldReinjectTurnstileScript({
        hasScriptTag: true,
        hasTurnstileGlobal: false,
      }),
    ).toBe(true);
  });

  it("keeps a script tag that loaded successfully", () => {
    expect(
      shouldReinjectTurnstileScript({
        hasScriptTag: true,
        hasTurnstileGlobal: true,
      }),
    ).toBe(false);
  });

  it("does nothing when no script tag was injected yet", () => {
    expect(
      shouldReinjectTurnstileScript({
        hasScriptTag: false,
        hasTurnstileGlobal: false,
      }),
    ).toBe(false);
  });
});

describe("SECURE_CHECK_UNAVAILABLE_COPY", () => {
  it("explains the cause and the next step without apologizing", () => {
    const { title, description, retryLabel } = SECURE_CHECK_UNAVAILABLE_COPY;

    expect(title).toBe("Security check didn't load");
    expect(description).toContain("ad blocker");
    expect(description).toContain("challenges.cloudflare.com");
    expect(description).toContain("retry");
    expect(retryLabel).toBe("Retry");
    expect(`${title} ${description}`.toLowerCase()).not.toContain("sorry");
    expect(`${title} ${description}`.toLowerCase()).not.toContain("almost");
  });
});
