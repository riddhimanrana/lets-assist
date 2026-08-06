"use client";

import type { Dispatch, SetStateAction } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DetectedPdfField } from "@/lib/waiver/pdf-field-detect";
import { FieldListPanel, type FieldMapping } from "../FieldListPanel";
import type { CustomPlacement } from "../PdfViewerWithOverlay";
import { SignaturePlacementsEditor } from "../SignaturePlacementsEditor";
import {
  SignerRolesEditor,
  type WaiverDefinitionSignerInput,
} from "../SignerRolesEditor";

type ViewerMode = "view" | "add-signature" | "edit";

type Props = {
  activeTab: string;
  setActiveTab: Dispatch<SetStateAction<string>>;
  detectedFields: DetectedPdfField[];
  fieldMappings: Record<string, FieldMapping>;
  setFieldMappings: Dispatch<SetStateAction<Record<string, FieldMapping>>>;
  signers: WaiverDefinitionSignerInput[];
  setSigners: Dispatch<SetStateAction<WaiverDefinitionSignerInput[]>>;
  customPlacements: CustomPlacement[];
  setCustomPlacements: Dispatch<SetStateAction<CustomPlacement[]>>;
  highlightedField: DetectedPdfField | null;
  setHighlightedField: Dispatch<SetStateAction<DetectedPdfField | null>>;
  selectedPlacementId?: string;
  setSelectedPlacementId: Dispatch<SetStateAction<string | undefined>>;
  viewerMode: ViewerMode;
  setViewerMode: Dispatch<SetStateAction<ViewerMode>>;
};

export function WaiverBuilderSidebar(props: Props) {
  const {
    activeTab,
    setActiveTab,
    detectedFields,
    fieldMappings,
    setFieldMappings,
    signers,
    setSigners,
    customPlacements,
    setCustomPlacements,
    highlightedField,
    setHighlightedField,
    selectedPlacementId,
    setSelectedPlacementId,
    viewerMode,
    setViewerMode,
  } = props;

  return (
    <div className="h-full flex flex-col bg-background min-h-0">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="w-full justify-start h-auto px-2 py-1.5 sm:p-1 bg-muted/50 rounded-none border-b gap-1">
          <TabsTrigger
            value="signers"
            className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm text-[11px] sm:text-sm py-2 sm:py-2.5"
          >
            1. Signers
          </TabsTrigger>
          <TabsTrigger
            value="fields"
            className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm text-[11px] sm:text-sm py-2 sm:py-2.5"
          >
            2. Fields & Signatures
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-hidden min-h-0">
          <TabsContent
            value="signers"
            className="h-full m-0 p-3 sm:p-4 md:p-5 overflow-auto"
          >
            <div className="text-xs sm:text-sm text-muted-foreground mb-3 pb-3 border-b">
              Define roles that must sign this waiver (e.g., Volunteer, Parent,
              Guardian).
            </div>
            <SignerRolesEditor signers={signers} onSignersChange={setSigners} />
            <div className="mt-5 pt-4 border-t">
              <Button
                className="w-full"
                onClick={() => setActiveTab("fields")}
                variant="outline"
              >
                Next: Configure Fields
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="fields" className="h-full m-0 overflow-auto">
            <div className="p-3 sm:p-4 md:p-5 space-y-5 sm:space-y-6">
              {/* Section 1: Detected Fields */}
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  Detected PDF Fields
                  <span className="text-xs font-normal text-muted-foreground ml-auto bg-muted px-2 py-0.5 rounded-full">
                    {detectedFields.length}
                  </span>
                </h3>

                {/* Detection Summary Block */}
                <div className="bg-muted/30 p-3 rounded-md mb-4 text-xs border">
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">
                        Signer Roles
                      </span>
                      <span
                        className="font-medium"
                        data-testid="waiver-summary-signer-roles"
                      >
                        {signers.length}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">
                        Signature Fields
                      </span>
                      <span
                        className="font-medium"
                        data-testid="waiver-summary-signature-fields"
                      >
                        {
                          detectedFields.filter(
                            (f) => f.fieldType === "signature",
                          ).length
                        }
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">
                        Other Fields
                      </span>
                      <span
                        className="font-medium"
                        data-testid="waiver-summary-other-fields"
                      >
                        {
                          detectedFields.filter(
                            (f) => f.fieldType !== "signature",
                          ).length
                        }
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">
                        Custom Placements
                      </span>
                      <span
                        className="font-medium"
                        data-testid="waiver-summary-custom-placements"
                      >
                        {customPlacements.length}
                      </span>
                    </div>
                  </div>

                  {/* Warning States */}
                  {detectedFields.filter((f) => f.fieldType === "signature")
                    .length === 0 && (
                    <div className="flex items-start gap-2 text-warning bg-warning/10 border border-warning/40 p-2 rounded mt-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        No signature fields detected. Please use "Custom Field
                        Placements" below.
                      </span>
                    </div>
                  )}

                  {detectedFields.filter((f) => f.fieldType === "signature")
                    .length > 0 &&
                    detectedFields.filter((f) => f.fieldType === "signature")
                      .length < signers.length && (
                      <div className="flex items-start gap-2 text-info bg-info/10 border border-info/40 p-2 rounded mt-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          Fewer signature fields than signer roles. You may need
                          custom placements.
                        </span>
                      </div>
                    )}

                  {/* Parent/Guardian heuristic warning */}
                  {signers.some(
                    (s) =>
                      s.roleKey.toLowerCase().includes("parent") ||
                      s.roleKey.toLowerCase().includes("guardian"),
                  ) &&
                    !detectedFields.some(
                      (f) =>
                        (f.fieldType === "text" || f.fieldType === "unknown") &&
                        (f.fieldName.toLowerCase().includes("email") ||
                          f.fieldName.toLowerCase().includes("phone")),
                    ) && (
                      <div className="flex items-start gap-2 text-warning bg-warning/10 border border-warning/40 p-2 rounded mt-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          Guardian role detected but no contact fields found.
                          Ensure you collect email/phone.
                        </span>
                      </div>
                    )}
                </div>

                <p className="text-xs text-muted-foreground mb-4">
                  These are interactive form fields detected in your PDF. Map
                  signature fields to roles.
                </p>

                {detectedFields.length > 0 ? (
                  <div className="border rounded-md max-h-88 sm:max-h-96 overflow-auto">
                    <FieldListPanel
                      detectedFields={detectedFields}
                      fieldMappings={fieldMappings}
                      signers={signers}
                      onFieldMappingChange={(key, mapping) =>
                        setFieldMappings((prev) => ({
                          ...prev,
                          [key]: mapping,
                        }))
                      }
                      onFieldClick={(field) => {
                        setHighlightedField(field);
                      }}
                      highlightedField={highlightedField}
                    />
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground border rounded-md p-4 text-center bg-muted/20">
                    No PDF form fields detected. <br />
                    Use "Custom Fields" below.
                  </div>
                )}
              </div>

              <Separator />

              {/* Section 2: Custom Placements */}
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  Custom Field Placements
                  <span className="text-xs font-normal text-muted-foreground ml-auto bg-muted px-2 py-0.5 rounded-full">
                    {customPlacements.length}
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Place labeled boxes, then choose type, signer, and e-sign
                  details.
                </p>

                <div className="border rounded-md max-h-96 sm:max-h-112 overflow-auto p-2">
                  <SignaturePlacementsEditor
                    placements={customPlacements}
                    signers={signers}
                    onPlacementsChange={setCustomPlacements}
                    onAddPlacement={() => setViewerMode("add-signature")}
                    selectedPlacementId={selectedPlacementId}
                    onSelectPlacement={(id) => {
                      setSelectedPlacementId(id);
                      setHighlightedField(null);
                    }}
                    isAddingPlacement={viewerMode === "add-signature"}
                  />
                </div>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
