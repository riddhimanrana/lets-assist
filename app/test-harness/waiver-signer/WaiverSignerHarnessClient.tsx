"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileSignature } from "lucide-react";
import { WaiverSigningDialog } from "@/components/waiver/WaiverSigningDialog";
import type { WaiverDefinitionFull } from "@/types/waiver-definitions";
import type { WaiverSignatureInput } from "@/types/waiver";

function createHarnessDefinition(pdfUrl: string): WaiverDefinitionFull {
  const now = new Date().toISOString();

  return {
    id: "harness-waiver-def",
    scope: "project",
    project_id: null,
    title: "Volunteer Waiver Harness",
    version: 1,
    active: true,
    pdf_storage_path: null,
    pdf_public_url: pdfUrl,
    source: "project_pdf",
    created_by: null,
    created_at: now,
    updated_at: now,
    signers: [
      {
        id: "signer-volunteer",
        waiver_definition_id: "harness-waiver-def",
        role_key: "volunteer",
        label: "Volunteer",
        required: true,
        order_index: 0,
        rules: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: "signer-guardian",
        waiver_definition_id: "harness-waiver-def",
        role_key: "guardian",
        label: "Parent/Guardian",
        required: true,
        order_index: 1,
        rules: null,
        created_at: now,
        updated_at: now,
      },
    ],
    fields: [
      {
        id: "field-global-email",
        waiver_definition_id: "harness-waiver-def",
        field_key: "global_email",
        field_type: "text",
        label: "Email Address",
        required: true,
        source: "custom_overlay",
        pdf_field_name: null,
        page_index: 0,
        rect: { x: 90, y: 650, width: 220, height: 24 },
        signer_role_key: null,
        meta: { placeholder: "you@example.com" },
        created_at: now,
        updated_at: now,
      },
      {
        id: "field-volunteer-name",
        waiver_definition_id: "harness-waiver-def",
        field_key: "volunteer_full_name",
        field_type: "text",
        label: "Volunteer Full Name",
        required: true,
        source: "custom_overlay",
        pdf_field_name: null,
        page_index: 0,
        rect: { x: 90, y: 620, width: 220, height: 24 },
        signer_role_key: "volunteer",
        meta: { placeholder: "Your full name" },
        created_at: now,
        updated_at: now,
      },
      {
        id: "field-volunteer-signature",
        waiver_definition_id: "harness-waiver-def",
        field_key: "volunteer_signature",
        field_type: "signature",
        label: "Volunteer Signature",
        required: true,
        source: "custom_overlay",
        pdf_field_name: null,
        page_index: 0,
        rect: { x: 90, y: 430, width: 230, height: 40 },
        signer_role_key: "volunteer",
        meta: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: "field-guardian-signature",
        waiver_definition_id: "harness-waiver-def",
        field_key: "guardian_signature",
        field_type: "signature",
        label: "Parent/Guardian Signature",
        required: true,
        source: "custom_overlay",
        pdf_field_name: null,
        page_index: 0,
        rect: { x: 90, y: 360, width: 230, height: 40 },
        signer_role_key: "guardian",
        meta: null,
        created_at: now,
        updated_at: now,
      },
    ],
  };
}

export function WaiverSignerHarnessClient() {
  const [open, setOpen] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<WaiverSignatureInput | null>(null);

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
    }

    const url = URL.createObjectURL(file);
    setPdfFile(file);
    setPdfUrl(url);
    setSubmitResult(null);
  };

  const definition = useMemo(() => {
    if (!pdfUrl) return null;
    return createHarnessDefinition(pdfUrl);
  }, [pdfUrl]);

  const signerMethods = submitResult?.payload && "signers" in submitResult.payload
    ? submitResult.payload.signers.map((signer) => signer.method).join(", ")
    : "";

  return (
    <div className="container mx-auto py-12 px-4 max-w-2xl" data-testid="waiver-signer-test-harness">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Waiver Signer Test Harness</h1>
        <p className="text-muted-foreground">Development/test environment for signer review and signature workflow</p>
      </div>

      <div className="border rounded-lg p-6 space-y-6">
        <div>
          <label htmlFor="signer-pdf-upload" className="block text-sm font-medium mb-2">
            Upload PDF Waiver
          </label>
          <input
            id="signer-pdf-upload"
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            data-testid="signer-pdf-upload-input"
            className="w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
          />
          {pdfFile && (
            <p className="mt-2 text-sm text-muted-foreground" data-testid="signer-selected-file-name">
              Selected: {pdfFile.name}
            </p>
          )}
        </div>

        <Button
          onClick={() => setOpen(true)}
          disabled={!definition}
          className="w-full"
          data-testid="open-signer-dialog-button"
        >
          <FileSignature className="mr-2 h-4 w-4" />
          Open Waiver Signer Dialog
        </Button>

        {submitResult && (
          <div className="border rounded-lg p-4 bg-muted/50" data-testid="signer-submit-result">
            <h3 className="font-medium mb-2">Last Submit Result</h3>
            <div className="text-sm space-y-1">
              <div>
                <span className="font-medium">Signature Type:</span>{" "}
                <span data-testid="signer-result-signature-type">{submitResult.signatureType}</span>
              </div>
              <div>
                <span className="font-medium">Signer Count:</span>{" "}
                <span data-testid="signer-result-signer-count">
                  {submitResult.payload && "signers" in submitResult.payload ? submitResult.payload.signers.length : 0}
                </span>
              </div>
              <div>
                <span className="font-medium">Methods:</span>{" "}
                <span data-testid="signer-result-methods">{signerMethods}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {definition && (
        <WaiverSigningDialog
          isOpen={open}
          onClose={setOpen}
          waiverDefinition={definition}
          waiverPdfUrl={pdfUrl}
          onComplete={async (payload) => {
            setSubmitResult(payload);
          }}
          defaultSignerName="Test Volunteer"
          defaultSignerEmail="test@example.com"
          allowUpload={true}
          disableEsignature={false}
        />
      )}

      <div className="mt-6 rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info flex items-start gap-2">
        <Upload className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          This harness is available only in non-production environments and is intended for automated E2E validation.
        </span>
      </div>
    </div>
  );
}
