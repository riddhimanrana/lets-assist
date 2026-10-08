import assert from "node:assert/strict";
import { mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  PaperScanBatchView,
  PaperScanSlotOption,
} from "./PaperSignupsClient";

let capture: {
  slot: PaperScanSlotOption;
  existingBatch: PaperScanBatchView;
} | null = null;
let review: { batch: PaperScanBatchView; sessionPublished: boolean } | null =
  null;
mock.module("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
mock.module("./actions", () => ({
  discardPaperScanBatch() {},
  retryPaperScanCertificates() {},
}));
mock.module("./manual-actions", () => ({ startManualAttendance() {} }));
mock.module("./CaptureStep", () => ({
  CaptureStep: (props: NonNullable<typeof capture>) => {
    capture = props;
    return <div>Saved scan capture</div>;
  },
}));
mock.module("./ReviewTable", () => ({
  ReviewTable: (props: NonNullable<typeof review>) => {
    review = props;
    return <div>Saved scan review</div>;
  },
}));
const { PaperSignupsClient } = await import("./PaperSignupsClient");
for (const slot of [
  {
    id: "oneTime",
    aliases: ["oneTime", "0", "default"],
    publishKey: "oneTime",
  },
  {
    id: "2026-09-20-0-0",
    aliases: ["2026-09-20-0-0", "2026-09-20-0", "0-0", "day-0-slot-0"],
    publishKey: "2026-09-20-0",
  },
  { id: "Setup", aliases: ["Setup", "role-0"], publishKey: "Setup" },
]) {
  for (const alias of slot.aliases) {
    for (const status of ["draft", "failed", "review"] as const) {
      capture = null;
      review = null;
      const batch = {
        id: "saved-batch",
        scheduleId: alias,
        status,
        imageCount: 2,
      };
      const markup = renderToStaticMarkup(
        <PaperSignupsClient
          projectId="fictional-project"
          projectTitle="Fictional project"
          projectTimezone="UTC"
          projectStatus="completed"
          publishedState={{ [slot.publishKey]: true }}
          slotOptions={[
            {
              ...slot,
              label: "Fictional session",
              windowStartsAt: 0,
              windowEndsAt: 3600000,
            },
          ]}
          initialBatch={batch}
          initialRows={[]}
          activeWindow={null}
        />,
      );
      if (status === "review") {
        assert.ok(markup.includes("Saved scan review"));
        assert.ok(review);
        const rendered = review as {
          batch: PaperScanBatchView;
          sessionPublished: boolean;
        };
        assert.equal(rendered.batch.scheduleId, alias);
        assert.equal(rendered.sessionPublished, true);
      } else {
        assert.ok(markup.includes("Saved scan capture"));
        assert.ok(capture);
        const rendered = capture as {
          slot: PaperScanSlotOption;
          existingBatch: PaperScanBatchView;
        };
        assert.equal(rendered.slot.id, slot.id);
        assert.equal(rendered.existingBatch.scheduleId, alias);
        assert.equal(rendered.existingBatch.id, "saved-batch");
      }
    }
  }
}
