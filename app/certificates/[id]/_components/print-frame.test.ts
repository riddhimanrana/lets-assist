import { expect, test } from "bun:test";
import { mountCertificatePrintFrame } from "./print-frame";

function fixture(fail = false) {
  let printed = 0;
  let removed = 0;
  let afterprint: (() => void) | undefined;
  const errors: unknown[] = [];
  const frame = {
    style: {},
    title: "",
    srcdoc: "",
    onload: null as (() => void) | null,
    remove: () => {
      removed++;
    },
    contentWindow: {
      focus: () => {},
      print: () => {
        printed++;
        if (fail) throw new Error("Print blocked");
      },
      addEventListener: (_event: string, listener: () => void) => {
        afterprint = listener;
      },
      removeEventListener: () => {
        afterprint = undefined;
      },
    },
  };
  const target = {
    createElement: () => frame,
    body: { appendChild: () => {} },
  } as unknown as Document;
  const cleanup = mountCertificatePrintFrame(
    "<p>Certificate</p>",
    (error) => errors.push(error),
    target,
  );
  return {
    frame,
    cleanup,
    errors,
    printed: () => printed,
    removed: () => removed,
    finish: () => afterprint?.(),
  };
}

test("keeps the document alive until printing or cancellation finishes", () => {
  const f = fixture();
  expect(f.printed()).toBe(0);
  f.frame.onload?.();
  expect(f.printed()).toBe(1);
  expect(f.removed()).toBe(0);
  f.finish();
  expect(f.removed()).toBe(1);
  f.cleanup();
  expect(f.removed()).toBe(1);
});

test("cleanup before load prevents a stale print attempt", () => {
  const f = fixture();
  const queuedLoad = f.frame.onload;
  f.cleanup();
  queuedLoad?.();
  expect(f.printed()).toBe(0);
  expect(f.removed()).toBe(1);
});

test("duplicate load events do not open two print dialogs", () => {
  const f = fixture();
  f.frame.onload?.();
  f.frame.onload?.();
  expect(f.printed()).toBe(1);
  f.cleanup();
});

test("a blocked print removes the frame and reports the error", () => {
  const f = fixture(true);
  f.frame.onload?.();
  expect(f.removed()).toBe(1);
  expect(f.errors).toHaveLength(1);
});
