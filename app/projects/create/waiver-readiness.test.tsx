import { expect, test, mock } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getWaiverStepError,
  WAIVER_DEFINITION_REQUIRED_MESSAGE,
} from "./create-blockers";
import { createInitialEventFormState } from "@/hooks/use-event-form";

// The PDF editor stays closed in these settings states. Keep its browser-only
// PDF engine out of the server-render fixture; readiness validation stays real.
mock.module("@/components/waiver/WaiverBuilderDialog", () => ({
  WaiverBuilderDialog: () => null,
}));
const { WaiverSettings } = await import("./SettingsWaiver");

function settings(waiverRequired: boolean) {
  const state = {
    ...createInitialEventFormState(),
    waiverRequired,
    waiverPdfUrl: "/fictional-waiver.pdf",
    waiverDefinition: { signers: [], fields: { detected: {}, custom: [] } },
  };
  return renderToStaticMarkup(
    createElement(WaiverSettings, {
      ...state,
      error: getWaiverStepError(state) ?? undefined,
      updateWaiverRequiredAction: () => {},
      updateWaiverAllowUploadAction: () => {},
      updateWaiverDisableEsignatureAction: () => {},
    }),
  );
}

test("incomplete signer configuration is explained on the actual waiver step", () => {
  const html = settings(true);
  expect(html).toContain('role="alert"');
  expect(html).toContain(WAIVER_DEFINITION_REQUIRED_MESSAGE);
});

test("switching waivers off hides stale configuration errors on that step", () => {
  const html = settings(false);
  expect(html).not.toContain(WAIVER_DEFINITION_REQUIRED_MESSAGE);
  expect(html).not.toContain('role="alert"');
  expect(html).toContain("Require waiver signature");
});

test("saved roles without signatures are described as incomplete with an actionable repair", () => {
  const html = renderToStaticMarkup(
    createElement(WaiverSettings, {
      waiverRequired: true,
      waiverDisableEsignature: false,
      waiverPdfUrl: "/synthetic.pdf",
      waiverDefinition: {
        signers: [
          {
            roleKey: "volunteer",
            label: "Volunteer",
            required: true,
            orderIndex: 0,
          },
          {
            roleKey: "guardian",
            label: "Guardian",
            required: true,
            orderIndex: 1,
          },
        ],
        fields: { detected: {}, custom: [] },
      },
      updateWaiverRequiredAction: () => {},
      updateWaiverAllowUploadAction: () => {},
      updateWaiverDisableEsignatureAction: () => {},
    }),
  );
  expect(html).not.toContain("Waiver configured");
  expect(html).toContain("Signature fields needed");
  expect(html).toContain(
    "Add a signature field for Volunteer and Guardian before saving.",
  );
  expect(html).toContain("Add signature fields");
});
