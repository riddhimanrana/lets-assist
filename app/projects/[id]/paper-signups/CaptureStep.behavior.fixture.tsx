// Each scenario runs in a child process to keep mocked browser boundaries local.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PaperScanBatchView } from "./PaperSignupsClient";

type ButtonProps = {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void | Promise<void>;
};
const buttons: ButtonProps[] = [];
const errors: string[] = [];
const requests: Array<{ url: string; body: unknown }> = [];
const recoveryFilters: Array<[string, unknown]> = [];
let reloads = 0;
let cameraInputs = 0;
const extracted: PaperScanBatchView[] = [];
const scenario = process.argv[2];

mock.module("@/components/ui/button", () => ({
  Button: (props: ButtonProps) => {
    buttons.push(props);
    return <button disabled={props.disabled}>{props.children}</button>;
  },
}));
mock.module("@/components/projects/paper-signup/PaperScanCameraInput", () => ({
  PaperScanCameraInput: () => {
    cameraInputs++;
    return <input aria-label="Add photos" type="file" />;
  },
}));
mock.module("@/components/projects/paper-signup/useImageDownscale", () => ({
  downscaleImageFiles: () => {
    throw new Error("A saved scan must not compress or upload photos again");
  },
}));
mock.module("./actions", () => ({
  createPaperScanBatch: () => {
    throw new Error("A saved scan must not create another batch");
  },
  queueOrphanedPaperScanUploads: () => {
    throw new Error("Registered photos must never be queued for deletion");
  },
}));
mock.module("sonner", () => ({
  toast: {
    error: (message: string) => errors.push(message),
    success: () => {},
    warning: () => {},
  },
}));
mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      assert.equal(table, "project_paper_scan_batches");
      const query = {
        select: (columns: string) => {
          assert.equal(columns, "status");
          return query;
        },
        eq: (column: string, value: unknown) => {
          recoveryFilters.push([column, value]);
          return query;
        },
        maybeSingle: async () => ({
          data: { status: scenario === "refused" ? "failed" : "review" },
          error: null,
        }),
      };
      return query;
    },
    storage: {
      from: () => {
        throw new Error("Retry must not touch stored photo objects");
      },
    },
  }),
}));

Object.defineProperty(globalThis, "window", {
  value: {
    setTimeout: (callback: () => void, ms: number) => {
      if (ms === 1000) {
        queueMicrotask(callback);
        return 0;
      }
      return setTimeout(callback, ms);
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    location: {
      reload: () => {
        reloads++;
      },
    },
  },
  configurable: true,
});
Object.defineProperty(globalThis, "fetch", {
  value: async (url: string, init: RequestInit) => {
    assert.equal(init.method, "POST");
    assert.ok(init.signal instanceof AbortSignal);
    requests.push({ url, body: JSON.parse(String(init.body)) });
    if (scenario === "lost-response")
      throw new Error("Fictional response lost after server success");
    if (scenario === "refused")
      return Response.json(
        { error: "No readable attendance rows were found." },
        { status: 422 },
      );
    return Response.json({ rowCount: 2, imagesProcessed: 2 });
  },
  configurable: true,
});
const { CaptureStep } = await import("./CaptureStep");
const batch: PaperScanBatchView = {
  id: "saved-batch",
  scheduleId: "oneTime",
  status: "draft",
  imageCount: 2,
};
// The page passes persisted failed status through to the client view.
if (scenario === "failed" || scenario === "refused") batch.status = "failed";
if (scenario === "empty") batch.imageCount = 0;
if (scenario === "different-slot") batch.scheduleId = "other-slot";
if (scenario === "extracting") batch.status = "extracting";
const slot = {
  id: "oneTime",
  aliases: ["oneTime", "0", "default"],
  label: "Fictional session",
  windowStartsAt: 0,
  windowEndsAt: 3600000,
};
if (scenario === "oneTime-alias") batch.scheduleId = "default";
if (scenario === "multiDay-alias") {
  slot.id = "2026-09-20-0-0";
  slot.aliases = [slot.id, "2026-09-20-0", "0-0", "day-0-slot-0"];
  batch.scheduleId = "0-0";
}
if (scenario === "role-alias") {
  slot.id = "Setup";
  slot.aliases = ["Setup", "role-0"];
  batch.scheduleId = "role-0";
}
const markup = renderToStaticMarkup(
  <CaptureStep
    projectId="fictional-project"
    slot={slot}
    existingBatch={batch}
    onBack={() => {}}
    onExtracted={(result) => extracted.push(result)}
  />,
);
const retry = buttons.find((button) =>
  renderToStaticMarkup(<>{button.children}</>).includes("Retry scan"),
);
if (scenario === "empty" || scenario === "different-slot") {
  assert.equal(retry, undefined);
  assert.equal(cameraInputs, 1);
  assert.ok(markup.includes("Photograph the sheet"));
  assert.equal(requests.length, 0);
} else if (scenario === "extracting") {
  assert.equal(retry, undefined);
  assert.equal(cameraInputs, 0);
  assert.ok(markup.includes("Reading the uploaded sheet"));
  assert.equal(requests.length, 0);
} else {
  assert.ok(
    retry,
    "Saved draft and failed batches need an explicit retry action",
  );
  assert.equal(retry.disabled, false, "Retry does not require local photos");
  assert.equal(
    cameraInputs,
    0,
    "Saved retry should not ask for another upload",
  );
  assert.ok(markup.includes("2 uploaded photos are saved"));
  assert.ok(retry.onClick);
  await retry.onClick();
  assert.deepEqual(requests, [
    { url: "/api/ai/scan-signup-sheet", body: { batchId: "saved-batch" } },
  ]);
  if (scenario === "lost-response" || scenario === "refused") {
    assert.equal(extracted.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(
      reloads,
      1,
      "Recovery reloads authoritative saved batch state",
    );
    assert.deepEqual(recoveryFilters, [
      ["id", "saved-batch"],
      ["project_id", "fictional-project"],
    ]);
  } else {
    assert.deepEqual(extracted, [
      {
        id: "saved-batch",
        scheduleId: batch.scheduleId,
        status: "review",
        imageCount: 2,
      },
    ]);
    assert.equal(errors.length, 0);
    assert.equal(reloads, 0);
  }
}
