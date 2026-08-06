"use client";

import { useMemo } from "react";

import { normalizeCustomPlacementFieldType } from "@/lib/waiver/custom-field-config";
import type { DetectedPdfField } from "@/lib/waiver/pdf-field-detect";
import type { SignerData } from "@/types/waiver-definitions";
import type { FieldMapping } from "../FieldListPanel";
import type { CustomPlacement } from "../PdfViewerWithOverlay";
import type { WaiverDefinitionSignerInput } from "../SignerRolesEditor";
import { SAMPLE_FIELD_TEXT } from "./definition-mappings";

export function useWaiverSampleValues({
  fieldMappings,
  signers,
  detectedFields,
  customPlacements,
}: {
  fieldMappings: Record<string, FieldMapping>;
  signers: WaiverDefinitionSignerInput[];
  detectedFields: DetectedPdfField[];
  customPlacements: CustomPlacement[];
}) {
  const detectedFieldRoleMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(fieldMappings).map(([fieldName, mapping]) => [
          fieldName,
          mapping?.signerRoleKey,
        ]),
      ) as Record<string, string | undefined>,
    [fieldMappings],
  );

  const signatures = useMemo<Record<string, SignerData>>(() => {
    const timestamp = new Date().toISOString();
    return Object.fromEntries(
      signers.map((signer) => [
        signer.roleKey,
        {
          role_key: signer.roleKey,
          method: "typed" as const,
          data: signer.label || "Sample Signer",
          timestamp,
          signer_name: signer.label || "Sample Signer",
        },
      ]),
    );
  }, [signers]);

  const fieldValues = useMemo(() => {
    const values: Record<string, string | boolean | number | null | undefined> =
      {};
    for (const field of detectedFields) {
      const type = normalizeCustomPlacementFieldType(field.fieldType);
      if (type !== "signature")
        values[field.fieldName] = SAMPLE_FIELD_TEXT[type];
    }
    for (const placement of customPlacements) {
      if (placement.fieldType !== "signature") {
        values[placement.fieldKey || placement.id] =
          SAMPLE_FIELD_TEXT[placement.fieldType] ?? SAMPLE_FIELD_TEXT.text;
      }
    }
    return values;
  }, [detectedFields, customPlacements]);

  return {
    detectedFieldRoleMap,
    sampleValueLayer: { fieldValues, signatures },
  };
}
