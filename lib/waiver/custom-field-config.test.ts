import { describe, expect, it } from "vitest";

import {
  CUSTOM_PLACEMENT_FIELD_TYPE_OPTIONS,
  createRectFromCenter,
  ensureRectMeetsFieldMinimums,
  getCustomPlacementFieldSize,
  normalizeCustomPlacementFieldType,
  resizeRectToFieldType,
} from "@/lib/waiver/custom-field-config";

describe("custom-field-config", () => {
  it("omits radio and dropdown from custom placement options", () => {
    const values = CUSTOM_PLACEMENT_FIELD_TYPE_OPTIONS.map((option) => option.value);

    expect(values).not.toContain("radio");
    expect(values).not.toContain("dropdown");
    expect(values).toContain("initial");
  });

  it("falls back unsupported custom placement types to text", () => {
    expect(normalizeCustomPlacementFieldType("radio")).toBe("text");
    expect(normalizeCustomPlacementFieldType("dropdown")).toBe("text");
  });

  it("resizes a rect to the field preset while keeping its center point", () => {
    const rect = { x: 100, y: 200, width: 165, height: 30 };
    const resized = resizeRectToFieldType(rect, "initial");
    const initialSize = getCustomPlacementFieldSize("initial");

    expect(resized.width).toBe(initialSize.width);
    expect(resized.height).toBe(initialSize.height);
    expect(resized.x + resized.width / 2).toBe(rect.x + rect.width / 2);
    expect(resized.y + resized.height / 2).toBe(rect.y + rect.height / 2);
  });

  it("creates rects from the preset size around a center point", () => {
    const rect = createRectFromCenter(120, 240, "checkbox");
    const checkboxSize = getCustomPlacementFieldSize("checkbox");

    expect(rect).toEqual({
      x: 120 - checkboxSize.width / 2,
      y: 240 - checkboxSize.height / 2,
      width: checkboxSize.width,
      height: checkboxSize.height,
    });
  });

  it("expands small rects to meet the field minimums", () => {
    const rect = { x: 200, y: 300, width: 50, height: 20 };
    const resized = ensureRectMeetsFieldMinimums(rect, "signature");
    const signatureSize = getCustomPlacementFieldSize("signature");

    expect(resized.width).toBe(signatureSize.minWidth);
    expect(resized.height).toBe(signatureSize.minHeight);
    expect(resized.x + resized.width / 2).toBe(rect.x + rect.width / 2);
    expect(resized.y + resized.height / 2).toBe(rect.y + rect.height / 2);
  });
});