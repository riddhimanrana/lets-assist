import type { PdfRect } from "@/lib/waiver/pdf-field-detect";
import type { WaiverFieldType } from "@/types/waiver-definitions";

export type CustomPlacementFieldType = Exclude<WaiverFieldType, "radio" | "dropdown">;

type CustomPlacementFieldTypeOption = {
  value: CustomPlacementFieldType;
  label: string;
};

type CustomPlacementFieldSize = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
};

const DEFAULT_CUSTOM_PLACEMENT_FIELD_TYPE: CustomPlacementFieldType = "text";

export const CUSTOM_PLACEMENT_FIELD_TYPE_OPTIONS = [
  { value: "signature", label: "Signature" },
  { value: "initial", label: "Initials" },
  { value: "name", label: "Name" },
  { value: "date", label: "Date" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "address", label: "Address" },
  { value: "text", label: "Text" },
  { value: "checkbox", label: "Checkbox" },
] as const satisfies ReadonlyArray<CustomPlacementFieldTypeOption>;

const CUSTOM_PLACEMENT_FIELD_SIZES: Record<CustomPlacementFieldType, CustomPlacementFieldSize> = {
  signature: {
    width: 180,
    height: 50,
    minWidth: 140,
    minHeight: 40,
  },
  initial: {
    width: 84,
    height: 30,
    minWidth: 60,
    minHeight: 24,
  },
  name: {
    width: 170,
    height: 30,
    minWidth: 110,
    minHeight: 24,
  },
  date: {
    width: 104,
    height: 30,
    minWidth: 86,
    minHeight: 24,
  },
  email: {
    width: 210,
    height: 30,
    minWidth: 140,
    minHeight: 24,
  },
  phone: {
    width: 145,
    height: 30,
    minWidth: 110,
    minHeight: 24,
  },
  address: {
    width: 240,
    height: 44,
    minWidth: 170,
    minHeight: 30,
  },
  text: {
    width: 165,
    height: 30,
    minWidth: 110,
    minHeight: 24,
  },
  checkbox: {
    width: 48,
    height: 28,
    minWidth: 28,
    minHeight: 20,
  },
};

export function isCustomPlacementFieldType(value: string): value is CustomPlacementFieldType {
  return CUSTOM_PLACEMENT_FIELD_TYPE_OPTIONS.some((option) => option.value === value);
}

export function normalizeCustomPlacementFieldType(value: string): CustomPlacementFieldType {
  return isCustomPlacementFieldType(value) ? value : DEFAULT_CUSTOM_PLACEMENT_FIELD_TYPE;
}

export function getCustomPlacementFieldSize(
  fieldType: string | WaiverFieldType,
): CustomPlacementFieldSize {
  return CUSTOM_PLACEMENT_FIELD_SIZES[normalizeCustomPlacementFieldType(fieldType)];
}

export function createRectFromCenter(
  centerX: number,
  centerY: number,
  fieldType: string | WaiverFieldType,
): PdfRect {
  const { width, height } = getCustomPlacementFieldSize(fieldType);

  return {
    x: Math.max(0, centerX - width / 2),
    y: Math.max(0, centerY - height / 2),
    width,
    height,
  };
}

export function resizeRectToFieldType(
  rect: PdfRect,
  fieldType: string | WaiverFieldType,
): PdfRect {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return createRectFromCenter(centerX, centerY, fieldType);
}

export function ensureRectMeetsFieldMinimums(
  rect: PdfRect,
  fieldType: string | WaiverFieldType,
): PdfRect {
  const { minWidth, minHeight } = getCustomPlacementFieldSize(fieldType);

  if (rect.width >= minWidth && rect.height >= minHeight) {
    return rect;
  }

  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  return {
    x: Math.max(0, centerX - Math.max(rect.width, minWidth) / 2),
    y: Math.max(0, centerY - Math.max(rect.height, minHeight) / 2),
    width: Math.max(rect.width, minWidth),
    height: Math.max(rect.height, minHeight),
  };
}