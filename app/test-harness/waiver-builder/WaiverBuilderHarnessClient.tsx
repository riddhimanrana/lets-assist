"use client";

import { useState } from "react";
import { WaiverBuilderDialog } from "@/components/waiver/WaiverBuilderDialog";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import type { WaiverDefinitionInput } from "@/components/waiver/WaiverBuilderDialog";

export function WaiverBuilderHarnessClient() {
  const [open, setOpen] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<WaiverDefinitionInput | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPdfFile(file);
      const url = URL.createObjectURL(file);
      setPdfUrl(url);
      setSaveResult(null);
    }
  };

  const handleSave = async (definition: WaiverDefinitionInput) => {
    setSaveResult(definition);
    return Promise.resolve();
  };

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
      />
    </div>
  );
}
