"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";

import {
  ensureRectMeetsFieldMinimums,
  normalizeCustomPlacementFieldType,
} from "@/lib/waiver/custom-field-config";
import type { CustomPlacement } from "../PdfViewerWithOverlay";
import type { WaiverDefinitionSignerInput } from "../SignerRolesEditor";

type AiField = {
  fieldType: string;
  label: string;
  signerRole: string;
  pageIndex: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  required: boolean;
};

type AiAnalysis = {
  signerRoles: Array<{
    roleKey: string;
    label: string;
    required: boolean;
  }>;
  fields: AiField[];
  pageCount: number;
};

export function useWaiverAiScan({
  pdfFile,
  setSigners,
  setCustomPlacements,
  setActiveTab,
}: {
  pdfFile: File | null;
  setSigners: Dispatch<SetStateAction<WaiverDefinitionSignerInput[]>>;
  setCustomPlacements: Dispatch<SetStateAction<CustomPlacement[]>>;
  setActiveTab: Dispatch<SetStateAction<string>>;
}) {
  const [isScanning, setIsScanning] = useState(false);

  const handleAIScan = async () => {
    if (!pdfFile) {
      toast.error("No PDF file available");
      return;
    }

    setIsScanning(true);
    const loadingToast = toast.loading("Analyzing waiver with AI...", {
      description: "This may take a few moments",
    });

    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      const response = await fetch("/api/ai/analyze-waiver", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as {
        error?: string;
        analysis?: AiAnalysis;
      };

      toast.dismiss(loadingToast);
      if (!response.ok) {
        const error = data.error ?? "";
        if (error.includes("inappropriate") || error.includes("explicit")) {
          toast.error("PDF content appears inappropriate", {
            description: "Please upload a valid waiver document.",
            duration: 6000,
          });
        } else if (
          error.includes("not a waiver") ||
          error.includes("cannot analyze")
        ) {
          toast.error("Couldn't recognize this as a waiver", {
            description: "Please configure fields manually.",
            duration: 6000,
          });
        } else {
          toast.error("AI analysis failed", {
            description: error || "Please try again or configure manually.",
            duration: 6000,
          });
        }
        return;
      }

      const analysis = data.analysis;
      if (!analysis?.signerRoles?.length && !analysis?.fields?.length) {
        toast.error("No recognizable fields found", {
          description:
            "AI couldn't detect any fields. Please configure manually.",
          duration: 6000,
        });
        return;
      }
      if (!analysis) return;

      if (analysis.signerRoles.length > 0) {
        setSigners(
          analysis.signerRoles.map((role, index) => ({
            ...role,
            orderIndex: index,
          })),
        );
      }

      const timestamp = Date.now();
      setCustomPlacements(
        analysis.fields.map((field, index) => {
          const id = `ai_${timestamp}_${index}`;
          const fieldType = normalizeCustomPlacementFieldType(field.fieldType);
          return {
            id,
            fieldKey: id,
            label: field.label,
            signerRoleKey: field.signerRole,
            fieldType,
            required: field.required,
            pageIndex: field.pageIndex,
            rect: ensureRectMeetsFieldMinimums(field.boundingBox, fieldType),
            meta: { helpText: "", signingPurpose: "" },
          };
        }),
      );
      setActiveTab("fields");

      toast.success("AI scan complete!", {
        description: `Detected ${analysis.signerRoles.length} signer role(s) and ${analysis.fields.length} field(s) across ${analysis.pageCount} page(s).`,
        duration: 6000,
      });
      toast.warning("AI placements are best-effort", {
        description:
          "Please verify every box and adjust manually before saving.",
        duration: 8000,
      });
    } catch (error) {
      console.error("AI scan error:", error);
      toast.error("Network error during analysis", {
        description: "Please try again or configure manually.",
        duration: 6000,
      });
    } finally {
      setIsScanning(false);
    }
  };

  return { isScanning, handleAIScan };
}
