import type { DetectedPdfField } from "@/lib/waiver/pdf-field-detect";
import type { WaiverFieldType } from "@/types/waiver-definitions";
import type { CustomPlacement } from "../PdfViewerWithOverlay";
import type { FieldMapping } from "../FieldListPanel";
import type { WaiverDefinitionSignerInput } from "../SignerRolesEditor";
import type { WaiverDefinitionInput } from "./types";

export const SAMPLE_FIELD_TEXT: Record<WaiverFieldType, string | boolean> = {
  signature: "Alex Johnson",
  initial: "AJ",
  name: "Alex Johnson",
  date: new Date().toISOString().slice(0, 10),
  email: "alex@example.com",
  phone: "123-456-7890",
  address: "123 Main St, Springfield, IL 62701",
  checkbox: true,
  text: "Sample value",
  radio: "Option A",
  dropdown: "Option A",
};

function hydrateMappingForDetectedField(
  detectedField: DetectedPdfField,
  savedMapping: FieldMapping,
): FieldMapping {
  return {
    ...savedMapping,
    fieldKey: detectedField.fieldName,
    fieldType: detectedField.fieldType,
    pageIndex: detectedField.pageIndex,
    rect: detectedField.rect,
    pdfFieldName: detectedField.fieldName,
    required: savedMapping.required ?? detectedField.required ?? false,
  };
}

function rectSimilarityScore(
  a: CustomPlacement["rect"],
  b: CustomPlacement["rect"],
): number {
  return (
    Math.abs(a.x - b.x) +
    Math.abs(a.y - b.y) +
    Math.abs(a.width - b.width) +
    Math.abs(a.height - b.height)
  );
}

export function reconcileDetectedMappings(
  savedMappings: Record<string, FieldMapping>,
  detected: DetectedPdfField[],
): Record<string, FieldMapping> {
  if (
    !savedMappings ||
    Object.keys(savedMappings).length === 0 ||
    detected.length === 0
  ) {
    return savedMappings ?? {};
  }

  const reconciled: Record<string, FieldMapping> = {};
  const remaining = new Map<string, FieldMapping>(
    Object.entries(savedMappings),
  );
  const unmatchedDetected: DetectedPdfField[] = [];

  // Pass 1: direct name-based matches (field key / pdf field name)
  detected.forEach((field) => {
    const direct = remaining.get(field.fieldName);
    if (direct) {
      reconciled[field.fieldName] = hydrateMappingForDetectedField(
        field,
        direct,
      );
      remaining.delete(field.fieldName);
      return;
    }

    const aliasMatch = Array.from(remaining.entries()).find(([, mapping]) => {
      return (
        mapping.pdfFieldName === field.fieldName ||
        mapping.fieldKey === field.fieldName
      );
    });

    if (aliasMatch) {
      const [matchedKey, matchedMapping] = aliasMatch;
      reconciled[field.fieldName] = hydrateMappingForDetectedField(
        field,
        matchedMapping,
      );
      remaining.delete(matchedKey);
      return;
    }

    unmatchedDetected.push(field);
  });

  // Pass 2: geometry/page/type-based fallback for legacy random keys
  unmatchedDetected.forEach((field) => {
    let bestKey: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const [savedKey, savedMapping] of remaining.entries()) {
      if (savedMapping.pageIndex !== field.pageIndex) continue;
      if (savedMapping.fieldType !== field.fieldType) continue;

      const score = rectSimilarityScore(savedMapping.rect, field.rect);
      if (score < bestScore) {
        bestScore = score;
        bestKey = savedKey;
      }
    }

    // Geometry is in PDF points. <= 24 allows slight parser drift while preventing bad matches.
    if (bestKey && bestScore <= 24) {
      const bestMapping = remaining.get(bestKey);
      if (bestMapping) {
        reconciled[field.fieldName] = hydrateMappingForDetectedField(
          field,
          bestMapping,
        );
        remaining.delete(bestKey);
      }
    }
  });

  return reconciled;
}

function buildDetectedMappingsForSave(
  detectedFields: DetectedPdfField[],
  fieldMappings: Record<string, FieldMapping>,
): Record<string, FieldMapping> {
  if (!detectedFields.length) {
    return { ...fieldMappings };
  }

  const completeDetectedMappings: Record<string, FieldMapping> = {};
  const matchedSavedKeys = new Set<string>();

  detectedFields.forEach((field) => {
    const directMapping = fieldMappings[field.fieldName];
    const aliasEntry = !directMapping
      ? Object.entries(fieldMappings).find(([, mapping]) => {
          return (
            mapping.pdfFieldName === field.fieldName ||
            mapping.fieldKey === field.fieldName
          );
        })
      : undefined;

    const userMapping = directMapping ?? aliasEntry?.[1];
    const matchedKey = directMapping ? field.fieldName : aliasEntry?.[0];
    if (matchedKey) {
      matchedSavedKeys.add(matchedKey);
    }

    completeDetectedMappings[field.fieldName] = {
      fieldKey: field.fieldName,
      signerRoleKey: userMapping?.signerRoleKey || undefined,
      required: userMapping?.required ?? field.required ?? false,
      label: userMapping?.label || field.fieldName,
      fieldType: field.fieldType,
      pageIndex: field.pageIndex,
      rect: field.rect,
      pdfFieldName: field.fieldName,
      meta: userMapping?.meta ?? null,
    };
  });

  // Preserve unmatched legacy mappings so prior draft data isn't lost.
  Object.entries(fieldMappings).forEach(([key, mapping]) => {
    if (completeDetectedMappings[key] || matchedSavedKeys.has(key)) {
      return;
    }
    completeDetectedMappings[key] = mapping;
  });

  return completeDetectedMappings;
}

export function buildDefinitionPayload(
  signers: WaiverDefinitionSignerInput[],
  fieldMappings: Record<string, FieldMapping>,
  customPlacements: CustomPlacement[],
  detectedFields: DetectedPdfField[],
): WaiverDefinitionInput {
  return {
    signers,
    fields: {
      detected: buildDetectedMappingsForSave(detectedFields, fieldMappings),
      custom: customPlacements,
    },
  };
}
