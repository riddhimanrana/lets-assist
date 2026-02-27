interface DetectedFieldInput {
  fieldKey: string;
  fieldType: string;
  pageIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  pdfFieldName?: string;
  label?: string;
  required?: boolean;
  signerRoleKey?: string;
  meta?: Record<string, unknown> | null;
}

interface CustomPlacementInput {
  id?: string;
  fieldKey?: string;
  label?: string;
  fieldType?: string;
  pageIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  signerRoleKey?: string;
  required?: boolean;
  meta?: Record<string, unknown> | null;
}

function normalizeSignatureRect(rect: { x: number; y: number; width: number; height: number }) {
  // Signature boxes frequently get detected as a single text-line height.
  // Enforce a sane minimum so drawn signatures are readable.
  return {
    ...rect,
    width: Math.max(rect.width, 180),
    height: Math.max(rect.height, 50),
  };
}

export function mapDetectedFieldsForDb(
  definitionId: string,
  mappings: DetectedFieldInput[]
) {
  return mappings.map(mapping => ({
    waiver_definition_id: definitionId,
    field_key: mapping.fieldKey,
    field_type: mapping.fieldType,
    label: mapping.label || mapping.fieldKey,
    source: 'pdf_widget' as const,
    page_index: mapping.pageIndex,
    rect: mapping.fieldType === 'signature' ? normalizeSignatureRect(mapping.rect) : mapping.rect,
    pdf_field_name: mapping.pdfFieldName || mapping.fieldKey,
    required: mapping.required ?? false,
    signer_role_key: mapping.signerRoleKey || null,
    meta: mapping.meta ?? null,
  }));
}

export function mapCustomPlacementsForDb(
  definitionId: string,
  placements: CustomPlacementInput[]
) {
  return placements.map(placement => ({
    waiver_definition_id: definitionId,
    field_key: placement.fieldKey || placement.id || `signature-${Date.now()}`,
    field_type: placement.fieldType || 'signature',
    label: placement.label || 'Signature',
    source: 'custom_overlay' as const,
    page_index: placement.pageIndex,
    rect: (placement.fieldType || 'signature') === 'signature'
      ? normalizeSignatureRect(placement.rect)
      : placement.rect,
    required: placement.required ?? true,
    signer_role_key: placement.signerRoleKey || null,
    pdf_field_name: null,
    meta: placement.meta ?? null,
  }));
}
