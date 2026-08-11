"use client";

import { useMemo } from "react";

import type {
  WaiverDefinitionFull,
  WaiverDefinitionSigner,
} from "@/types/waiver-definitions";
import type { CustomPlacement } from "../PdfViewerWithOverlay";
import type { WaiverSigningStep } from "./types";

const legacySigner = (): WaiverDefinitionSigner => ({
  id: "legacy-signer",
  waiver_definition_id: "legacy",
  role_key: "volunteer",
  label: "Volunteer",
  required: true,
  order_index: 0,
  rules: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

export function useWaiverSigningDefinition(
  waiverDefinition: WaiverDefinitionFull | null | undefined,
  safeWaiverPdfUrl: string | null,
) {
  const effectiveDefinition = useMemo<WaiverDefinitionFull>(() => {
    if (waiverDefinition) return waiverDefinition;
    return {
      id: "legacy",
      scope: "project",
      project_id: null,
      title: "Waiver",
      version: 1,
      active: true,
      pdf_storage_path: null,
      pdf_public_url: safeWaiverPdfUrl,
      source: "project_pdf",
      created_by: null,
      created_at: "",
      updated_at: "",
      signers: [legacySigner()],
      fields: [],
    } as WaiverDefinitionFull;
  }, [waiverDefinition, safeWaiverPdfUrl]);

  const sortedSigners = useMemo(() => {
    if (effectiveDefinition.signers.length === 0) return [legacySigner()];
    return [...effectiveDefinition.signers].sort(
      (first, second) => first.order_index - second.order_index,
    );
  }, [effectiveDefinition.signers]);

  const steps = useMemo<WaiverSigningStep[]>(() => {
    const result: WaiverSigningStep[] = [
      {
        id: "review",
        type: "review",
        title: "Review Waiver",
        description: "Please review the waiver document.",
      },
    ];

    if (
      effectiveDefinition.fields.some(
        (field) => field.field_type !== "signature" && !field.signer_role_key,
      )
    ) {
      result.push({
        id: "global-fields",
        type: "fields",
        title: "Your Information",
        description: "Please provide your details.",
      });
    }

    for (const signer of sortedSigners) {
      const signerFields = effectiveDefinition.fields.filter(
        (field) =>
          field.signer_role_key === signer.role_key &&
          field.field_type !== "signature",
      );
      if (signerFields.length > 0) {
        result.push({
          id: `fields-${signer.role_key}`,
          type: "fields",
          title: `${signer.label} Information`,
          description: `Please fill in the required fields for ${signer.label}.`,
          signer,
        });
      }

      const hasSignatureField = effectiveDefinition.fields.some(
        (field) =>
          field.signer_role_key === signer.role_key &&
          field.field_type === "signature",
      );
      const isLegacyVolunteer =
        effectiveDefinition.id === "legacy" && signer.role_key === "volunteer";
      if (hasSignatureField || isLegacyVolunteer) {
        result.push({
          id: `sign-${signer.role_key}`,
          type: "sign",
          title: `Sign as ${signer.label}`,
          description: `Please provide your signature for ${signer.label}.`,
          signer,
        });
      }
    }

    if (result.length > 0) result[result.length - 1].isLast = true;
    return result;
  }, [effectiveDefinition, sortedSigners]);

  const generatedWaiverPreview = useMemo(() => {
    const labels = sortedSigners.map((signer) => signer.label).join(", ");
    return [
      "WAIVER & RELEASE OF LIABILITY",
      "",
      "By participating in this activity, I acknowledge and agree that participation may involve risks, including possible injury, loss, or damage.",
      "",
      "I voluntarily assume all such risks and release the organizer, host venue, and affiliated staff/volunteers from claims arising from my participation, except where prohibited by law.",
      "",
      `This waiver applies to the following signer role(s): ${labels || "Volunteer"}.`,
      "",
      "I confirm that I have read this waiver, understand its contents, and agree that my electronic signature is legally binding.",
      "",
      "Signed electronically via Lets Assist.",
    ].join("\n");
  }, [sortedSigners]);

  const allPlacements = useMemo<CustomPlacement[]>(
    () =>
      effectiveDefinition.fields.map((field) => ({
        id: field.id ?? field.field_key,
        fieldKey: field.field_key,
        label: field.label,
        signerRoleKey: field.signer_role_key || "global",
        fieldType: field.field_type,
        required: field.required,
        pageIndex: field.page_index,
        rect: field.rect,
      })),
    [effectiveDefinition.fields],
  );

  return {
    effectiveDefinition,
    sortedSigners,
    steps,
    generatedWaiverPreview,
    allPlacements,
  };
}
