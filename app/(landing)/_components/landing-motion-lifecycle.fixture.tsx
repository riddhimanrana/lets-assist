import assert from "node:assert/strict";
import {
  advance,
  elementsIn,
  installBrowserStandIns,
  intervals,
  listenerCount,
  mount,
  preferReducedMotion,
  showDocument,
  textIn,
  timeouts,
  timers,
  timersCreated,
} from "./landing-motion-runtime.fixture";

// Runs the real landing components, their real effects and the real
// foreground-motion hook against the hook runtime, manual clock and stand-ins
// for `document` and `matchMedia` in landing-motion-runtime.fixture.ts.
// Nothing is painted: the assertions read the element tree each component
// returns and the timers and listeners it leaves behind. Each scenario runs in
// its own process because `mock.module` is global to a process.
const scenario = process.env.LETS_ASSIST_MOTION_SCENARIO ?? "";

// The discoverable test has already put the runtime hooks behind `react`. The
// components load before any browser global exists, as they do when the
// other landing tests render them on a server.
export async function runMotionScenario() {
  const { AnimatePresence } = await import("motion/react");
  const { ComparisonTextFlip } = await import("./ComparisonTextFlip");
  const { QRScannerPreview } = await import("./journey/QRScannerPreview");

  installBrowserStandIns();

  const STRONG_EASE_OUT = [0.23, 1, 0.32, 1];
  const VISIBILITY_AND_PREFERENCE_LISTENERS = 2;

  function assertNothingLeftBehind() {
    assert.equal(timers.size, 0);
    assert.equal(listenerCount(), 0);
  }

  // The comparison headline's flipping word, with fictional words.
  const WORDS = ["alpha", "bravo", "charlie"];

  function flipWord(output: unknown) {
    const tree = elementsIn(output);
    const words = tree.filter(
      (node) => typeof node.props.children === "string",
    );
    assert.equal(words.length, 1);
    const [word] = words;
    const animated = tree.filter(
      (node) => node.type === AnimatePresence || "animate" in node.props,
    );
    return { text: word.props.children as string, word, tree, animated };
  }

  function assertPlainWord(output: unknown, text: string) {
    const flip = flipWord(output);
    assert.equal(flip.text, text);
    assert.equal(flip.word.type, "span");
    assert.equal(flip.word.props.style, undefined);
    assert.deepEqual(flip.animated, []);
  }

  function assertAnimatedWord(output: unknown, text: string) {
    const flip = flipWord(output);
    assert.equal(flip.text, text);
    const presence = flip.tree.filter((node) => node.type === AnimatePresence);
    assert.equal(presence.length, 1);
    assert.equal(presence[0].props.initial, false);
    assert.equal(presence[0].props.mode, "wait");
    assert.deepEqual(flip.word.props.transition, {
      duration: 0.4,
      ease: STRONG_EASE_OUT,
    });
  }

  function flipScenario(name: string) {
    if (name === "flip-effect-replay") {
      const flip = mount(ComparisonTextFlip, { words: WORDS });
      advance(2500);
      for (let replay = 0; replay < 2; replay += 1) {
        flip.replayEffects();
        assertAnimatedWord(flip.output, "bravo");
        assert.equal(intervals().length, 1);
        assert.equal(listenerCount(), VISIBILITY_AND_PREFERENCE_LISTENERS);
      }
      advance(2500);
      assertAnimatedWord(flip.output, "charlie");
      flip.unmount();
      assertNothingLeftBehind();
    } else if (name === "flip-cycle") {
      const flip = mount(ComparisonTextFlip, { words: WORDS });
      assertAnimatedWord(flip.output, "alpha");
      assert.equal(intervals().length, 1);
      assert.equal(timeouts().length, 0);
      assert.equal(listenerCount(), VISIBILITY_AND_PREFERENCE_LISTENERS);
      advance(2499);
      assertAnimatedWord(flip.output, "alpha");
      advance(1);
      assertAnimatedWord(flip.output, "bravo");
      advance(2500);
      assertAnimatedWord(flip.output, "charlie");
      advance(2500);
      assertAnimatedWord(flip.output, "alpha");
      assert.equal(timers.size, 1);
      flip.unmount();
      assertNothingLeftBehind();
      advance(10_000);
      assertNothingLeftBehind();
    } else if (name === "flip-hidden") {
      const flip = mount(ComparisonTextFlip, { words: WORDS });
      advance(2500);
      assertAnimatedWord(flip.output, "bravo");
      advance(1000);
      showDocument(false);
      assert.equal(timers.size, 0);
      advance(60_000);
      assertAnimatedWord(flip.output, "bravo");
      showDocument(true);
      assert.equal(intervals().length, 1);
      // A full interval passes before the next word, not the unspent remainder.
      advance(2499);
      assertAnimatedWord(flip.output, "bravo");
      advance(1);
      assertAnimatedWord(flip.output, "charlie");
      // Repeated events for the same state do not stack timers.
      showDocument(true);
      showDocument(true);
      assert.equal(timers.size, 1);
      flip.unmount();
      assertNothingLeftBehind();
    } else if (name === "flip-hidden-mount") {
      showDocument(false, false);
      const flip = mount(ComparisonTextFlip, { words: WORDS });
      assertAnimatedWord(flip.output, "alpha");
      assert.equal(timersCreated(), 0);
      advance(60_000);
      assertAnimatedWord(flip.output, "alpha");
      assert.equal(timersCreated(), 0);
      showDocument(true);
      assert.equal(intervals().length, 1);
      advance(2500);
      assertAnimatedWord(flip.output, "bravo");
      flip.unmount();
      assertNothingLeftBehind();
    } else if (name === "flip-reduced") {
      preferReducedMotion(true, false);
      const flip = mount(ComparisonTextFlip, { words: WORDS });
      assertPlainWord(flip.output, "alpha");
      assert.equal(timersCreated(), 0);
      advance(60_000);
      assertPlainWord(flip.output, "alpha");
      assert.equal(timersCreated(), 0);

      preferReducedMotion(false);
      assertAnimatedWord(flip.output, "alpha");
      assert.equal(intervals().length, 1);
      advance(2500);
      assertAnimatedWord(flip.output, "bravo");
      // 200ms into what would be a 400ms flip in a browser. This runtime has no
      // animation frames, so what it proves is that the same pass that hears
      // the preference drops every animated wrapper and the timer.
      advance(200);
      preferReducedMotion(true);
      assertPlainWord(flip.output, "bravo");
      assert.equal(timers.size, 0);
      advance(60_000);
      assertPlainWord(flip.output, "bravo");
      flip.unmount();
      assertNothingLeftBehind();
    } else if (name === "flip-short") {
      const none = mount(ComparisonTextFlip, { words: [] as string[] });
      assertAnimatedWord(none.output, "");
      const one = mount(ComparisonTextFlip, { words: ["alpha"] });
      assertAnimatedWord(one.output, "alpha");
      advance(60_000);
      assertAnimatedWord(none.output, "");
      assertAnimatedWord(one.output, "alpha");
      assert.equal(timersCreated(), 0);
      // A second word is what makes the timer worth starting.
      one.update({ words: ["alpha", "bravo"] });
      assert.equal(intervals().length, 1);
      advance(2500);
      assertAnimatedWord(one.output, "bravo");
      const createdForTwoWords = timersCreated();
      one.update({ words: ["alpha"] });
      assert.equal(timers.size, 0);
      assert.equal(timersCreated(), createdForTwoWords);
      assertAnimatedWord(one.output, "alpha");
      none.unmount();
      one.unmount();
      assertNothingLeftBehind();
    } else {
      return false;
    }
    return true;
  }

  // The journey's QR scanner preview.
  function scanner(output: unknown) {
    const tree = elementsIn(output);
    const toasts = tree.filter((node) => "aria-hidden" in node.props);
    assert.equal(toasts.length, 1);
    const [toast] = toasts;
    const looping = tree.filter((node) =>
      Object.values((node.props.animate ?? {}) as object).some(Array.isArray),
    );
    return {
      text: textIn(output),
      toast,
      toastAnimate: toast.props.animate as Record<string, number>,
      toastTransition: toast.props.transition as Record<string, unknown>,
      looping,
    };
  }

  function assertIdle(output: unknown) {
    const view = scanner(output);
    assert.equal(view.toast.props["aria-hidden"], true);
    assert.deepEqual(view.toastAnimate, { opacity: 0, y: 6, scale: 0.98 });
    assert.ok(view.text.includes("Scanning…"));
    assert.ok(view.text.includes("Scan to check in"));
    assert.equal(timeouts().length, 0);
  }

  function assertDetected(output: unknown) {
    const view = scanner(output);
    assert.equal(view.toast.props["aria-hidden"], false);
    assert.deepEqual(view.toastAnimate, { opacity: 1, y: 0, scale: 1 });
    assert.match(textIn(view.toast), /^Checked in • \S/u);
    assert.ok(view.text.includes("Scanning…"));
    assert.equal(timeouts().length, 1);
  }

  function assertNoLiveRegion(output: unknown) {
    for (const node of elementsIn(output)) {
      assert.equal(node.props["aria-live"], undefined);
      assert.equal(node.props.role, undefined);
    }
  }

  function scannerScenario(name: string) {
    if (name === "qr-effect-replay") {
      const preview = mount(QRScannerPreview, {});
      advance(2800);
      assertDetected(preview.output);
      for (let replay = 0; replay < 2; replay += 1) {
        preview.replayEffects();
        assertIdle(preview.output);
        assert.equal(intervals().length, 1);
        assert.equal(listenerCount(), VISIBILITY_AND_PREFERENCE_LISTENERS);
      }
      advance(2800);
      assertDetected(preview.output);
      preview.unmount();
      assertNothingLeftBehind();
    } else if (name === "qr-cycle") {
      const preview = mount(QRScannerPreview, {});
      assertIdle(preview.output);
      assert.equal(intervals().length, 1);
      assert.equal(listenerCount(), VISIBILITY_AND_PREFERENCE_LISTENERS);
      assert.equal(scanner(preview.output).looping.length, 2);
      assert.deepEqual(scanner(preview.output).toastTransition, {
        duration: 0.2,
        ease: STRONG_EASE_OUT,
      });
      advance(2799);
      assertIdle(preview.output);
      advance(1);
      assertDetected(preview.output);
      assertNoLiveRegion(preview.output);
      advance(899);
      assertDetected(preview.output);
      advance(1);
      assertIdle(preview.output);
      // The next detection is 2800ms after the first, not after the clear.
      advance(1899);
      assertIdle(preview.output);
      advance(1);
      assertDetected(preview.output);
      advance(900);
      assertIdle(preview.output);
      assert.equal(timers.size, 1);
      preview.unmount();
      assertNothingLeftBehind();
    } else if (name === "qr-hidden") {
      const preview = mount(QRScannerPreview, {});
      advance(2800);
      assertDetected(preview.output);
      // Hidden with the 900ms clear still pending.
      advance(300);
      showDocument(false);
      assertIdle(preview.output);
      assert.equal(timers.size, 0);
      advance(60_000);
      assertIdle(preview.output);
      assert.equal(timers.size, 0);

      showDocument(true);
      assertIdle(preview.output);
      assert.equal(intervals().length, 1);
      advance(2799);
      assertIdle(preview.output);
      advance(1);
      assertDetected(preview.output);
      showDocument(true);
      assert.equal(intervals().length, 1);
      // Unmounted in the middle of a detection.
      preview.unmount();
      assertNothingLeftBehind();
      advance(10_000);
      assertNothingLeftBehind();
    } else if (name === "qr-hidden-mount") {
      showDocument(false, false);
      const preview = mount(QRScannerPreview, {});
      assertIdle(preview.output);
      assert.equal(timersCreated(), 0);
      advance(60_000);
      assertIdle(preview.output);
      assert.equal(timersCreated(), 0);
      showDocument(true);
      assert.equal(intervals().length, 1);
      advance(2800);
      assertDetected(preview.output);
      preview.unmount();
      assertNothingLeftBehind();
    } else if (name === "qr-reduced") {
      preferReducedMotion(true, false);
      const preview = mount(QRScannerPreview, {});
      assertIdle(preview.output);
      assert.deepEqual(scanner(preview.output).looping, []);
      assert.equal(scanner(preview.output).toastTransition.duration, 0);
      advance(60_000);
      assertIdle(preview.output);
      assert.equal(timersCreated(), 0);

      preferReducedMotion(false);
      assert.equal(intervals().length, 1);
      assert.equal(scanner(preview.output).looping.length, 2);
      advance(2800);
      assertDetected(preview.output);
      // The preference arrives while the toast is showing.
      advance(100);
      preferReducedMotion(true);
      assertIdle(preview.output);
      assert.equal(timers.size, 0);
      assert.deepEqual(scanner(preview.output).looping, []);
      assert.equal(scanner(preview.output).toastTransition.duration, 0);
      advance(60_000);
      assertIdle(preview.output);

      preferReducedMotion(false);
      advance(2800);
      assertDetected(preview.output);
      preview.unmount();
      assertNothingLeftBehind();
    } else if (name === "qr-steps") {
      // The journey section passes `shouldAnimate` as its in-view state.
      const preview = mount(QRScannerPreview, { shouldAnimate: false });
      assertIdle(preview.output);
      assert.deepEqual(scanner(preview.output).looping, []);
      advance(60_000);
      assert.equal(timersCreated(), 0);
      preview.update({ shouldAnimate: true });
      assert.equal(intervals().length, 1);
      assert.equal(scanner(preview.output).looping.length, 2);
      advance(2800);
      assertDetected(preview.output);
      preview.update({ shouldAnimate: false });
      assertIdle(preview.output);
      assert.equal(timers.size, 0);
      assert.equal(listenerCount(), VISIBILITY_AND_PREFERENCE_LISTENERS);
      preview.unmount();
      assertNothingLeftBehind();

      // The journey section remounts the preview for every step change.
      for (const lifetime of [0, 150, 2800, 3100, 3700, 40]) {
        const step = mount(QRScannerPreview, {});
        assertIdle(step.output);
        assert.equal(intervals().length, 1);
        advance(lifetime);
        step.unmount();
        assertNothingLeftBehind();
      }
      const last = mount(QRScannerPreview, {});
      assertIdle(last.output);
      assert.equal(timers.size, 1);
      assert.equal(listenerCount(), VISIBILITY_AND_PREFERENCE_LISTENERS);
      advance(2800);
      assertDetected(last.output);
      last.unmount();
      assertNothingLeftBehind();
    } else {
      return false;
    }
    return true;
  }

  assert.ok(
    flipScenario(scenario) || scannerScenario(scenario),
    `Unknown scenario: ${scenario}`,
  );
}
