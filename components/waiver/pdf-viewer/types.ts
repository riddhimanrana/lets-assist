import type { PdfRect } from "@/lib/waiver/pdf-field-detect";
import type { SignerData, WaiverFieldType } from "@/types/waiver-definitions";

export interface CustomPlacement {
  id: string;
  /** For definition-backed fields, this maps to `waiver_definition_fields.field_key` (used to look up entered values). */
  fieldKey?: string;
  label: string;
  signerRoleKey: string;
  fieldType: WaiverFieldType;
  required: boolean;
  pageIndex: number;
  rect: PdfRect;
  meta?: Record<string, unknown> | null;
}

export type PdfViewerValueLayer = {
  fieldValues: Record<string, string | boolean | number | null | undefined>;
  signatures: Record<string, SignerData | undefined>;
};
