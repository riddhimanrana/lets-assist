import { describe, expect, it } from "vitest";
import {
  mapVisionFallbackFields,
  stabilizeVisionFallbackFields,
  type AnalyzeWaiverNormalizedField,
  type AnalyzeWaiverPageDimension,
  type SelectableCandidate,
} from "./route";

const PAGE_DIMENSIONS: AnalyzeWaiverPageDimension[] = [
  { pageIndex: 0, width: 600, height: 800 },
];

describe("analyze-waiver vision stabilization", () => {
  it("maps top-left normalized boxes to bottom-left PDF coordinates", () => {
    const mapped = mapVisionFallbackFields(
      [
        {
          fieldType: "signature",
          label: "Volunteer Signature",
          signerRole: "volunteer",
          pageIndex: 0,
          normalizedBoxTopLeft: {
            x: 0.1,
            y: 0.2,
            width: 0.5,
            height: 0.1,
          },
          required: true,
          confidence: 0.92,
          reasoning: "Line below signature label",
        },
      ],
      PAGE_DIMENSIONS,
      1
    );

    expect(mapped).toHaveLength(1);
    expect(mapped[0].boundingBox.x).toBeCloseTo(60, 4);
    expect(mapped[0].boundingBox.width).toBeCloseTo(300, 4);
    expect(mapped[0].boundingBox.height).toBeCloseTo(80, 4);
    expect(mapped[0].boundingBox.y).toBeCloseTo(560, 4);
    expect(mapped[0].notes).toContain("Vision fallback placement");
  });

  it("anchors vision fields to the closest structural candidate", () => {
    const inputFields: AnalyzeWaiverNormalizedField[] = [
      {
        fieldType: "signature",
        label: "Volunteer Signature",
        signerRole: "volunteer",
        pageIndex: 0,
        boundingBox: {
          x: 95,
          y: 102,
          width: 210,
          height: 36,
        },
        required: true,
        notes: "Vision fallback placement",
      },
    ];

    const candidates: SelectableCandidate[] = [
      {
        id: "cand-signature-1",
        pageIndex: 0,
        rect: {
          x: 100,
          y: 100,
          width: 200,
          height: 40,
        },
        typeHint: "signature",
        score: 0.92,
        source: "underscore",
        nearbyLabelTypes: ["signature"],
      },
    ];

    const stabilized = stabilizeVisionFallbackFields(inputFields, candidates, PAGE_DIMENSIONS, {
      strict: true,
    });

    expect(stabilized.fields).toHaveLength(1);
    expect(stabilized.fields[0].boundingBox).toEqual(candidates[0].rect);
    expect(stabilized.fields[0].notes).toContain("Snapped to structural candidate");
    expect(stabilized.stats.anchoredCount).toBe(1);
    expect(stabilized.stats.rejectedCount).toBe(0);
  });

  it("rejects oversized low-signal fields in strict mode", () => {
    const inputFields: AnalyzeWaiverNormalizedField[] = [
      {
        fieldType: "date",
        label: "Date",
        signerRole: "volunteer",
        pageIndex: 0,
        boundingBox: {
          x: 0,
          y: 0,
          width: 540,
          height: 350,
        },
        required: true,
        notes: "Vision fallback placement",
      },
    ];

    const strictResult = stabilizeVisionFallbackFields(inputFields, [], PAGE_DIMENSIONS, {
      strict: true,
    });

    expect(strictResult.fields).toHaveLength(0);
    expect(strictResult.stats.rejectedCount).toBe(1);
    expect(strictResult.stats.rejectedOversizeCount).toBe(1);
    expect(strictResult.stats.rejectedLowSignalCount).toBe(1);

    const nonStrictResult = stabilizeVisionFallbackFields(inputFields, [], PAGE_DIMENSIONS, {
      strict: false,
    });

    expect(nonStrictResult.fields).toHaveLength(1);
    expect(nonStrictResult.stats.keptUnanchoredCount).toBe(1);
    expect(nonStrictResult.fields[0].notes).toContain("Unanchored vision fallback placement");
  });
});
