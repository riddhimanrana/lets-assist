"use client";

import { useMemo, useState } from "react";
import { WaiverBuilderDialog } from "@/components/waiver/WaiverBuilderDialog";
import { Button } from "@/components/ui/button";
import { Upload, Sparkles, Loader2 } from "lucide-react";
import type { WaiverDefinitionInput } from "@/components/waiver/WaiverBuilderDialog";

interface HarnessDiagnostics {
  includeDiagnostics?: boolean;
  modelRequested?: string;
  modelUsed?: string;
  modelRequestedAccepted?: boolean;
  strictHallucinationGuard?: boolean;
  pageCount?: number;
  textItemsCount?: number;
  labelCount?: number;
  candidateCount?: number;
  widgetCount?: number;
  aiSelectedFieldCount?: number;
  aiMappedFieldCount?: number;
  visionFallbackTriggered?: boolean;
  visionFieldsRaw?: number;
  visionFieldsAfterConfidence?: number;
  visionFieldsAnchored?: number;
  visionFieldsRejected?: number;
  visionFieldsRejectedLowSignal?: number;
  visionFieldsRejectedOversize?: number;
  visionFieldsKeptUnanchored?: number;
  finalFieldCount?: number;
}

interface HarnessField {
  fieldType: string;
  label: string;
  signerRole: string;
  pageIndex: number;
  required: boolean;
  notes?: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface HarnessAnalysis {
  pageCount: number;
  signerRoles?: Array<{ roleKey: string; label: string; required: boolean }>;
  fields: HarnessField[];
  diagnostics?: HarnessDiagnostics;
  summary?: string;
  recommendations?: string[];
}

interface HarnessApiResponse {
  success?: boolean;
  error?: string;
  analysis?: HarnessAnalysis;
}

const AI_MODEL_OPTIONS = [
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
  "google/gemini-3-flash",
] as const;

export function WaiverBuilderHarnessClient() {
  const [open, setOpen] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<WaiverDefinitionInput | null>(null);
  const [strictHallucinationGuard, setStrictHallucinationGuard] = useState(true);
  const [selectedModel, setSelectedModel] = useState<(typeof AI_MODEL_OPTIONS)[number]>(
    "google/gemini-2.5-flash-lite"
  );
  const [isHarnessScanning, setIsHarnessScanning] = useState(false);
  const [harnessAnalysis, setHarnessAnalysis] = useState<HarnessAnalysis | null>(null);
  const [harnessError, setHarnessError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPdfFile(file);
      const url = URL.createObjectURL(file);
      setPdfUrl(url);
      setSaveResult(null);
      setHarnessAnalysis(null);
      setHarnessError(null);
    }
  };

  const handleSave = async (definition: WaiverDefinitionInput) => {
    setSaveResult(definition);
    return Promise.resolve();
  };

  const handleRunHarnessScan = async () => {
    if (!pdfFile) return;

    setIsHarnessScanning(true);
    setHarnessError(null);

    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      formData.append("includeDiagnostics", "true");
      formData.append("strictHallucinationGuard", strictHallucinationGuard ? "true" : "false");
      formData.append("model", selectedModel);

      const response = await fetch("/api/ai/analyze-waiver", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as HarnessApiResponse;
      if (!response.ok || !payload.analysis) {
        setHarnessAnalysis(null);
        setHarnessError(payload.error || "Harness scan failed.");
        return;
      }

      setHarnessAnalysis(payload.analysis);
    } catch (error) {
      setHarnessAnalysis(null);
      setHarnessError(error instanceof Error ? error.message : "Harness scan failed.");
    } finally {
      setIsHarnessScanning(false);
    }
  };

  const suspiciousPlacements = useMemo(() => {
    if (!harnessAnalysis) return [];
    return harnessAnalysis.fields.filter((field) =>
      field.notes?.toLowerCase().includes("unanchored vision fallback")
    );
  }, [harnessAnalysis]);

  const anchoredPlacements = useMemo(() => {
    if (!harnessAnalysis) return 0;
    return harnessAnalysis.fields.filter((field) =>
      field.notes?.toLowerCase().includes("snapped to structural candidate")
    ).length;
  }, [harnessAnalysis]);

  const fieldsPerPage = useMemo(() => {
    if (!harnessAnalysis || harnessAnalysis.pageCount <= 0) return 0;
    return harnessAnalysis.fields.length / harnessAnalysis.pageCount;
  }, [harnessAnalysis]);

  return (
    <div className="container mx-auto py-12 px-4 max-w-2xl" data-testid="waiver-test-harness">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Waiver Builder Test Harness</h1>
        <p className="text-muted-foreground">Development/test environment for WaiverBuilderDialog</p>
      </div>

      <div className="border rounded-lg p-6 space-y-6">
        <div>
          <label htmlFor="pdf-upload" className="block text-sm font-medium mb-2">
            Upload PDF Waiver
          </label>
          <div className="flex items-center gap-4">
            <input
              id="pdf-upload"
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              data-testid="pdf-upload-input"
              className="flex-1 text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
            />
          </div>
          {pdfFile && <p className="mt-2 text-sm text-muted-foreground">Selected: {pdfFile.name}</p>}
        </div>

        <Button
          onClick={() => setOpen(true)}
          disabled={!pdfFile}
          className="w-full"
          data-testid="open-builder-button"
        >
          <Upload className="mr-2 h-4 w-4" />
          Open Waiver Builder
        </Button>

        <div className="border rounded-lg p-4 bg-muted/20 space-y-3" data-testid="ai-harness-panel">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-medium">AI Placement Harness</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Runs `/api/ai/analyze-waiver` with diagnostics to catch hallucinations and placement drift.
              </p>
            </div>

            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={strictHallucinationGuard}
                onChange={(event) => setStrictHallucinationGuard(event.target.checked)}
              />
              Strict anti-hallucination
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-medium">
              <span className="text-muted-foreground">AI model</span>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value as (typeof AI_MODEL_OPTIONS)[number])}
              >
                {AI_MODEL_OPTIONS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-md border bg-background/70 p-2 text-xs">
              <div className="text-muted-foreground">Run profile</div>
              <div className="mt-1 font-medium">
                {strictHallucinationGuard ? "Strict guard enabled" : "Strict guard disabled"}
              </div>
            </div>
          </div>

          <Button
            onClick={handleRunHarnessScan}
            disabled={!pdfFile || isHarnessScanning}
            variant="outline"
            className="w-full"
            data-testid="run-ai-harness-button"
          >
            {isHarnessScanning ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {isHarnessScanning ? "Running AI Harness..." : "Run AI Harness Scan"}
          </Button>

          {harnessError && (
            <div className="text-sm text-destructive border border-destructive/30 rounded-md bg-destructive/5 p-3">
              {harnessError}
            </div>
          )}

          {harnessAnalysis && (
            <div className="space-y-3 text-sm" data-testid="ai-harness-results">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">Pages</div>
                  <div className="font-semibold" data-testid="harness-pages">{harnessAnalysis.pageCount}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">Detected fields</div>
                  <div className="font-semibold" data-testid="harness-fields">{harnessAnalysis.fields.length}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">Anchored placements</div>
                  <div className="font-semibold" data-testid="harness-anchored">{anchoredPlacements}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">Suspicious placements</div>
                  <div className="font-semibold" data-testid="harness-suspicious">{suspiciousPlacements.length}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">Signer roles</div>
                  <div className="font-semibold" data-testid="harness-roles">{harnessAnalysis.signerRoles?.length ?? 0}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">Fields / page</div>
                  <div className="font-semibold">{fieldsPerPage.toFixed(2)}</div>
                </div>
              </div>

              {harnessAnalysis.summary && (
                <div className="rounded-md border p-3 bg-background/70 text-xs space-y-1">
                  <div className="font-semibold uppercase text-muted-foreground">Summary</div>
                  <p>{harnessAnalysis.summary}</p>
                </div>
              )}

              {!!harnessAnalysis.recommendations?.length && (
                <div className="rounded-md border p-3 bg-background/70 text-xs space-y-2">
                  <div className="font-semibold uppercase text-muted-foreground">Recommendations</div>
                  <ul className="list-disc pl-4 space-y-1">
                    {harnessAnalysis.recommendations.map((recommendation, index) => (
                      <li key={`${recommendation}-${index}`}>{recommendation}</li>
                    ))}
                  </ul>
                </div>
              )}

              {harnessAnalysis.diagnostics && (
                <div className="rounded-md border p-3 bg-background/70 space-y-2" data-testid="harness-diagnostics">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Diagnostics</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>Model requested: {harnessAnalysis.diagnostics.modelRequested ?? "n/a"}</div>
                    <div>Model used: {harnessAnalysis.diagnostics.modelUsed ?? "n/a"}</div>
                    <div>Candidates: {harnessAnalysis.diagnostics.candidateCount ?? 0}</div>
                    <div>Labels: {harnessAnalysis.diagnostics.labelCount ?? 0}</div>
                    <div>AI selected: {harnessAnalysis.diagnostics.aiSelectedFieldCount ?? 0}</div>
                    <div>AI mapped: {harnessAnalysis.diagnostics.aiMappedFieldCount ?? 0}</div>
                    <div>Vision raw: {harnessAnalysis.diagnostics.visionFieldsRaw ?? 0}</div>
                    <div>Vision anchored: {harnessAnalysis.diagnostics.visionFieldsAnchored ?? 0}</div>
                    <div>Vision rejected: {harnessAnalysis.diagnostics.visionFieldsRejected ?? 0}</div>
                    <div>Low-signal rejects: {harnessAnalysis.diagnostics.visionFieldsRejectedLowSignal ?? 0}</div>
                    <div>Oversize rejects: {harnessAnalysis.diagnostics.visionFieldsRejectedOversize ?? 0}</div>
                    <div>Final fields: {harnessAnalysis.diagnostics.finalFieldCount ?? 0}</div>
                  </div>
                </div>
              )}

              <details className="rounded-md border p-3 bg-background/70">
                <summary className="cursor-pointer font-medium">Field placements</summary>
                <div className="mt-2 space-y-2 max-h-72 overflow-auto pr-1">
                  {harnessAnalysis.fields.map((field, index) => (
                    <div key={`${field.label}-${field.pageIndex}-${index}`} className="rounded border p-2 text-xs">
                      <div className="font-medium">{field.label} ({field.fieldType})</div>
                      <div className="text-muted-foreground">
                        Page {field.pageIndex + 1} • Role: {field.signerRole} • {field.required ? "Required" : "Optional"}
                      </div>
                      <div>
                        x:{Math.round(field.boundingBox.x)} y:{Math.round(field.boundingBox.y)} w:{Math.round(field.boundingBox.width)} h:{Math.round(field.boundingBox.height)}
                      </div>
                      {field.notes && <div className="mt-1 text-muted-foreground">{field.notes}</div>}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>

        {saveResult && (
          <div className="border rounded-lg p-4 bg-muted/50" data-testid="save-result">
            <h3 className="font-medium mb-2">Last Save Result:</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">Signers:</span>{" "}
                <span data-testid="save-result-signers">{saveResult.signers.length}</span>
              </div>
              <div>
                <span className="font-medium">Detected Fields:</span>{" "}
                <span data-testid="save-result-detected-fields">{Object.keys(saveResult.fields.detected).length}</span>
              </div>
              <div>
                <span className="font-medium">Custom Placements:</span>{" "}
                <span data-testid="save-result-custom-placements">{saveResult.fields.custom.length}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <WaiverBuilderDialog
        open={open}
        onOpenChange={setOpen}
        pdfFile={pdfFile}
        pdfUrl={pdfUrl}
        detectedFields={[]}
        onSave={handleSave}
        existingDraftDefinition={saveResult}
        autoSaveDraft
      />
    </div>
  );
}
