"use client";

import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  QrCode,
  UserCheck,
  Clock,
  AlertTriangle,
  Info,
  Users,
  Lock,
  Clipboard,
  Eye,
  Link2,
  FileSignature,
  Upload,
  X,
  FileText,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VerificationMethod, ProjectVisibility } from "@/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { DetectedPdfField } from "@/lib/waiver/pdf-field-detect";
import { WaiverBuilderDialog, WaiverDefinitionInput } from "@/components/waiver/WaiverBuilderDialog";
import { Button } from "@/components/ui/button";

interface VerificationSettingsProps {
  verificationMethod: VerificationMethod;
  requireLogin: boolean;
  isOrganization: boolean; // Add this to detect if creating for an organization
  visibility: ProjectVisibility; // Project visibility setting
  enableVolunteerComments: boolean;
  showAttendeesPublicly: boolean;
  waiverRequired: boolean;
  waiverAllowUpload: boolean;
  waiverPdfFile?: File | null;
  waiverPdfUrl?: string | null;
  waiverPdfValidation?: { hasSignatureFields: boolean; warnings: string[] } | null;
  waiverDefinition?: WaiverDefinitionInput | null;
  detectedFields?: DetectedPdfField[] | null;
  updateVerificationMethodAction: (method: VerificationMethod) => void;
  updateRequireLoginAction: (requireLogin: boolean) => void;
  updateVisibilityAction: (visibility: ProjectVisibility) => void;
  updateEnableVolunteerCommentsAction: (enabled: boolean) => void;
  updateShowAttendeesPubliclyAction: (enabled: boolean) => void;
  updateWaiverRequiredAction: (enabled: boolean) => void;
  updateWaiverAllowUploadAction: (enabled: boolean) => void;
  updateWaiverPdfFileAction?: (file: File | null) => void;
  updateWaiverPdfValidationAction?: (validation: { hasSignatureFields: boolean; warnings: string[] } | null) => void;
  updateWaiverDefinitionAction?: (definition: WaiverDefinitionInput | null) => void;
  updateDetectedFieldsAction?: (fields: DetectedPdfField[] | null) => void;
  clearWaiverPdfAction?: () => void;
  restrictToOrgDomains?: boolean;
  updateRestrictToOrgDomainsAction?: (restrict: boolean) => void;
  allowedEmailDomains?: string[] | null;
  errors?: {
    verificationMethod?: string;
    requireLogin?: string;
    visibility?: string;
  };
}

export default function VerificationSettings({
  verificationMethod,
  requireLogin,
  isOrganization,
  visibility,
  enableVolunteerComments,
  showAttendeesPublicly,
  waiverRequired,
  waiverAllowUpload,
  waiverPdfFile,
  waiverPdfUrl,
  waiverPdfValidation,
  waiverDefinition,
  detectedFields,
  updateVerificationMethodAction,
  updateRequireLoginAction,
  updateVisibilityAction,
  updateEnableVolunteerCommentsAction,
  updateShowAttendeesPubliclyAction,
  updateWaiverRequiredAction,
  updateWaiverAllowUploadAction,
  updateWaiverPdfFileAction,
  updateWaiverPdfValidationAction,
  updateWaiverDefinitionAction,
  updateDetectedFieldsAction,
  clearWaiverPdfAction,
  restrictToOrgDomains = false,
  updateRestrictToOrgDomainsAction,
  allowedEmailDomains,
  errors = {},
}: VerificationSettingsProps) {
  const [isValidatingPdf, setIsValidatingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10MB

  const validatePdfFile = useCallback(async (file: File) => {
    setIsValidatingPdf(true);
    setPdfError(null);

    try {
      // ... existing checks ...
      // Check file type
      if (file.type !== 'application/pdf') {
        setPdfError('Please upload a PDF file');
        setIsValidatingPdf(false);
        return;
      }

      // Check file size
      if (file.size > MAX_PDF_SIZE) {
        setPdfError('File size must be less than 10MB');
        setIsValidatingPdf(false);
        return;
      }

      // Read file and validate structure
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // Check PDF header
      const header = String.fromCharCode(...bytes.slice(0, 5));
      if (header !== '%PDF-') {
        setPdfError('Invalid PDF file');
        setIsValidatingPdf(false);
        return;
      }

      // Use PDF.js-based widget detection with dynamic import to avoid server-side issues
      const { detectPdfWidgets } = await import('@/lib/waiver/pdf-field-detect');
      const detectionResult = await detectPdfWidgets(file);

      const warnings: string[] = [];
      
      // Simplified user-facing messages
      if (!detectionResult.success) {
        // Log technical details to console for debugging
        if (detectionResult.errors) {
          console.warn('PDF analysis warnings:', detectionResult.errors);
        }
      }

      if (!detectionResult.hasSignatureFields) {
        warnings.push('No pre-filled signature fields detected. You can configure custom signature placements in the next step.');
      } else if (detectionResult.success && detectionResult.fields.length > 0) {
        const sigFields = detectionResult.fields.filter(f => f.fieldType === 'signature');
        warnings.push(`Found ${sigFields.length} signature field(s) and ${detectionResult.fields.length - sigFields.length} other form field(s).`);
      }

      // Update state
      updateWaiverPdfFileAction?.(file);
      updateWaiverPdfValidationAction?.({ hasSignatureFields: detectionResult.hasSignatureFields, warnings });
      
      // Store detected fields and open builder
      if (detectionResult.success) {
         updateDetectedFieldsAction?.(detectionResult.fields);
         // Open builder automatically
         setShowBuilder(true);
      }
      
    } catch (error) {
      console.error('Error validating PDF:', error);
      setPdfError('Error reading PDF file. Please try again.');
    } finally {
      setIsValidatingPdf(false);
    }
  }, [updateWaiverPdfFileAction, updateWaiverPdfValidationAction, updateDetectedFieldsAction]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      validatePdfFile(file);
    }
  }, [validatePdfFile]);

  const handleRemovePdf = useCallback(() => {
    clearWaiverPdfAction?.();
    setPdfError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [clearWaiverPdfAction]);

  const hasWaiverPdf = waiverPdfFile || waiverPdfUrl;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Volunteer Check-in Method
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Info className="h-4 w-4" />
                  </Button>
                } />
                <TooltipContent className="text-xs font-normal">
                  Choose how volunteers will check in and record their hours at
                  your event.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={verificationMethod}
            onValueChange={(value) =>
              updateVerificationMethodAction(value as VerificationMethod)
            }
            className="grid gap-3 sm:gap-4"
          >
            <label
              htmlFor="qr-code"
              className={cn(
                "flex flex-col items-start space-y-2 sm:space-y-3 rounded-lg border p-3 sm:p-4 hover:bg-accent cursor-pointer transition-colors",
                verificationMethod === "qr-code" && "border-primary bg-accent",
                errors.verificationMethod && "border-destructive",
              )}
            >
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <RadioGroupItem value="qr-code" id="qr-code" className="shrink-0" />
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
                    <QrCode className="shrink-0 h-5 w-5 text-primary" />
                    <span className="font-medium text-sm sm:text-base leading-snug">QR Code Self Check-in</span>
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className="pointer-events-none text-xs shrink-0 self-start sm:self-center whitespace-nowrap"
                >
                  Recommended
                </Badge>
              </div>
              <div className="text-xs sm:text-sm text-muted-foreground pl-7 sm:pl-9 leading-relaxed w-full">
                Volunteers scan QR code and log in to track their own hours.
                They can leave anytime, with automatic logout at the scheduled
                end time. Hours can be adjusted if needed.
              </div>
            </label>

            <label
              htmlFor="manual"
              className={cn(
                "flex flex-col items-start space-y-2 sm:space-y-3 rounded-lg border p-3 sm:p-4 hover:bg-accent cursor-pointer transition-colors",
                verificationMethod === "manual" && "border-primary bg-accent",
                errors.verificationMethod && "border-destructive",
              )}
            >
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <RadioGroupItem value="manual" id="manual" className="shrink-0" />
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
                    <UserCheck className="shrink-0 h-5 w-5 text-primary" />
                    <span className="font-medium text-sm sm:text-base leading-snug">Manual Check-in by Organizer</span>
                  </div>
                </div>
              </div>
              <div className="text-xs sm:text-sm text-muted-foreground pl-7 sm:pl-9 leading-relaxed w-full">
                You&apos;ll manually log each volunteer&apos;s attendance and
                hours. Most time-consuming for organizers but provides the
                highest level of verification.
              </div>
            </label>

            <label
              htmlFor="auto"
              className={cn(
                "flex flex-col items-start space-y-2 sm:space-y-3 rounded-lg border p-3 sm:p-4 hover:bg-accent cursor-pointer transition-colors",
                verificationMethod === "auto" && "border-primary bg-accent",
                errors.verificationMethod && "border-destructive",
              )}
            >
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <RadioGroupItem value="auto" id="auto" className="shrink-0" />
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
                    <Clock className="shrink-0 h-5 w-5 text-primary" />
                    <span className="font-medium text-sm sm:text-base leading-snug">Automatic Check-in/out</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 self-start sm:self-center">
                  <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                  <Badge
                    variant="secondary"
                    className="pointer-events-none text-warning bg-warning/10 text-xs whitespace-nowrap"
                  >
                    Not Recommended
                  </Badge>
                </div>
              </div>
              <div className="text-xs sm:text-sm text-muted-foreground pl-7 sm:pl-9 leading-relaxed w-full">
                System automatically logs attendance for the full scheduled
                time. Least accurate for attendance tracking.
              </div>
            </label>

            {/* Add the new signup-only option */}
            <label
              htmlFor="signup-only"
              className={cn(
                "flex flex-col items-start space-y-2 sm:space-y-3 rounded-lg border p-3 sm:p-4 hover:bg-accent cursor-pointer transition-colors",
                verificationMethod === "signup-only" && "border-primary bg-accent",
                errors.verificationMethod && "border-destructive",
              )}
            >
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <RadioGroupItem value="signup-only" id="signup-only" className="shrink-0" />
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
                    <Clipboard className="shrink-0 h-5 w-5 text-primary" />
                    <span className="font-medium text-sm sm:text-base leading-snug">
                      Sign-up Only (No Hour Tracking)
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-xs sm:text-sm text-muted-foreground pl-7 sm:pl-9 leading-relaxed w-full">
                Simplest option that only collects volunteer signups without tracking hours.
                Perfect for events where you just need a headcount or when attendance is tracked separately.
              </div>
            </label>
          </RadioGroup>

          {errors.verificationMethod && (
            <div className="text-destructive text-sm flex items-center gap-2 mt-4">
              <AlertTriangle className="h-4 w-4" />
              {errors.verificationMethod}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Volunteer Sign-up Requirements
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Info className="h-4 w-4" />
                  </Button>
                } />
                <TooltipContent className="text-xs font-normal">
                  <p>
                    Control whether volunteers need to create an account to sign
                    up for your event.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="flex items-center justify-between space-x-4">
              <div className="flex items-center space-x-3">
                <div
                  className={cn(
                    "p-2 rounded-md",
                    requireLogin ? "bg-primary/10" : "bg-muted",
                    errors.requireLogin && "border border-destructive",
                  )}
                >
                  {requireLogin ? (
                    <Lock className="h-5 w-5 text-primary" />
                  ) : (
                    <Users className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <Label
                    htmlFor="require-login"
                    className="text-base font-medium"
                  >
                    Require account for sign-up
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {requireLogin
                      ? "Volunteers must create an account to sign up for your event"
                      : "Anyone can sign up without creating an account (anonymous volunteers)"}
                  </p>
                </div>
              </div>
              <Switch
                id="require-login"
                checked={requireLogin}
                onCheckedChange={updateRequireLoginAction}
              />
            </div>

            {errors.requireLogin && (
              <div className="text-destructive text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {errors.requireLogin}
              </div>
            )}

            {!requireLogin && (
              <div className="rounded-lg bg-warning/10 p-4 text-sm border border-warning/40">
                <div className="flex gap-2">
                  <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-warning">Anonymous sign-ups</p>
                    <p className="text-warning mt-1">
                      With anonymous sign-ups enabled, volunteers won&apos;t need to create
                      accounts. This may increase participation but makes tracking and
                      verification more challenging.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Volunteer Options
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Info className="h-4 w-4" />
                  </Button>
                } />
                <TooltipContent className="text-xs font-normal max-w-xs">
                  <p>
                    Optional settings that control what volunteers can submit and what is visible publicly.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="flex items-center justify-between space-x-4">
              <div className="flex items-center space-x-3 flex-1">
                <div className="flex-1">
                  <Label
                    htmlFor="enable-comments"
                    className="text-base font-medium cursor-pointer"
                  >
                    Enable volunteer comments
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Allow volunteers to include a short note when signing up.
                  </p>
                </div>
              </div>
              <Switch
                id="enable-comments"
                checked={enableVolunteerComments}
                onCheckedChange={updateEnableVolunteerCommentsAction}
              />
            </div>

            <div className="flex items-center justify-between space-x-4">
              <div className="flex items-center space-x-3 flex-1">
                <div className="flex-1">
                  <Label
                    htmlFor="show-attendees-public"
                    className="text-base font-medium cursor-pointer"
                  >
                    Show attendees publicly
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Display attendee names on the project page.
                  </p>
                </div>
              </div>
              <Switch
                id="show-attendees-public"
                checked={showAttendeesPublicly}
                onCheckedChange={updateShowAttendeesPubliclyAction}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Waiver & Consent
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Info className="h-4 w-4" />
                  </Button>
                } />
                <TooltipContent className="text-xs font-normal max-w-xs">
                  <p>
                    Upload your organization&apos;s waiver PDF and require volunteers to sign it during signup. Supports e-signatures (draw or type).
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="flex items-center justify-between space-x-4">
              <div className="flex items-center space-x-3 flex-1">
                <div
                  className={cn(
                    "p-2 rounded-md",
                    waiverRequired ? "bg-primary/10" : "bg-muted",
                  )}
                >
                  <FileSignature className={cn("h-5 w-5", waiverRequired ? "text-primary" : "text-muted-foreground")} />
                </div>
                <div className="flex-1">
                  <Label htmlFor="waiver-required" className="text-base font-medium cursor-pointer">
                    Require waiver signature
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Volunteers must sign your waiver before completing signup.
                  </p>
                </div>
              </div>
              <Switch
                id="waiver-required"
                checked={waiverRequired}
                onCheckedChange={updateWaiverRequiredAction}
              />
            </div>

            {waiverRequired && (
              <>
                {/* PDF Upload Section */}
                <div className="space-y-3 pt-2">
                  <Label className="text-sm font-medium">Waiver Document (PDF)</Label>

                  {!hasWaiverPdf ? (
                    <div className="space-y-2">
                      <div
                        className={cn(
                          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors",
                          isValidatingPdf && "opacity-50 pointer-events-none",
                          pdfError && "border-destructive"
                        )}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="application/pdf"
                          onChange={handleFileChange}
                          className="hidden"
                        />
                        {isValidatingPdf ? (
                          <div className="flex flex-col items-center gap-2">
                            <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
                            <p className="text-sm text-muted-foreground">Validating PDF...</p>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            <Upload className="h-8 w-8 text-muted-foreground" />
                            <p className="text-sm font-medium">Click to upload your waiver PDF</p>
                            <p className="text-xs text-muted-foreground">Max size: 10MB</p>
                          </div>
                        )}
                      </div>
                      {pdfError && (
                        <p className="text-sm text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-4 w-4" />
                          {pdfError}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
                        <div className="flex items-center gap-3">
                          <FileText className="h-8 w-8 text-primary" />
                          <div>
                            <p className="text-sm font-medium">
                              {waiverPdfFile?.name || 'Waiver PDF'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {waiverPdfFile
                                ? `${(waiverPdfFile.size / 1024).toFixed(1)} KB`
                                : 'Uploaded'}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleRemovePdf}
                          className="text-destructive hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Validation Feedback */}
                      {waiverPdfValidation && (
                        <div className="space-y-2">
                          {waiverPdfValidation.hasSignatureFields ? (
                            <Alert className="bg-success/10 border-success">
                              <CheckCircle2 className="h-4 w-4 text-success" />
                              <AlertDescription className="text-success">
                                Signature fields detected in the PDF.
                              </AlertDescription>
                            </Alert>
                          ) : (
                            <Alert className="bg-warning/10 border-warning">
                              <AlertTriangle className="h-4 w-4 text-warning" />
                              <AlertDescription className="text-warning">
                                {waiverPdfValidation.warnings.join(' ')}
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>
                      )}
                      
                      {/* Builder Trigger */}
                      <div className="pt-2">
                        {waiverDefinition ? (
                           <div className="flex items-center gap-2 p-3 border-success rounded-md bg-success/10">
                              <CheckCircle2 className="h-5 w-5 text-success" />
                              <div className="flex-1">
                                <p className="text-sm font-medium">Waiver Configured</p>
                                <p className="text-xs text-muted-foreground">
                                   {waiverDefinition.signers.length} signer role(s) defined.
                                </p>
                              </div>
                              <Button variant="outline" size="sm" onClick={() => setShowBuilder(true)}>
                                 Edit Configuration
                              </Button>
                           </div>
                        ) : (
                           <Button 
                             onClick={() => setShowBuilder(true)} 
                             className="w-full"
                             variant={waiverDefinition ? "outline" : "default"}
                           >
                             <FileSignature className="mr-2 h-4 w-4" />
                             Configure Waiver Signers & Fields
                           </Button>
                        )}
                        {!waiverDefinition && (
                           <p className="text-xs text-muted-foreground mt-2 text-center">
                              You must configure signature placements before continuing.
                           </p>
                        )}
                      </div>
                    </div>
                  )}

                  {!hasWaiverPdf && (
                    <Alert className="bg-info/20 border-info">

                      <AlertDescription className="text-info text-xs flex gap-2">
                        <Info className="h-4 w-4 text-info text-xs" />
                        If you don&apos;t upload a custom waiver, the global platform waiver template will be used instead.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                {/* Waiver Builder Dialog */}
                {showBuilder && (
                   <WaiverBuilderDialog
                     open={showBuilder}
                     onOpenChange={setShowBuilder}
                     pdfFile={waiverPdfFile || null}
                     pdfUrl={waiverPdfUrl || null}
                     detectedFields={detectedFields || []}
                     onSave={async (def) => {
                        updateWaiverDefinitionAction?.(def);
                        setShowBuilder(false);
                     }}
                     existingDefinition={undefined} // No existing DB definition yet
                   />
                )}

                {/* Print & Upload Option */}
                <div className="flex items-center justify-between space-x-4">
                  <div className="flex items-center space-x-3 flex-1">
                    <div className={cn("p-2 rounded-md", waiverRequired ? "bg-primary/10" : "bg-muted")}
                    >
                      <FileSignature className={cn("h-5 w-5", waiverRequired ? "text-primary" : "text-muted-foreground")} />
                    </div>
                    <div className="flex-1">
                      <Label htmlFor="waiver-allow-upload" className="text-base font-medium cursor-pointer">
                        Allow print & upload
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Let volunteers download, print, sign physically, scan, and upload.
                      </p>
                    </div>
                  </div>
                  <Switch
                    id="waiver-allow-upload"
                    checked={waiverAllowUpload}
                    onCheckedChange={updateWaiverAllowUploadAction}
                    disabled={!waiverRequired}
                  />
                </div>
              </>
            )}

            {!waiverRequired && (
              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                Enable this if your organization requires volunteers to sign a liability waiver or consent form.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Project Visibility - available to everyone */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Who Can See This Project?
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Info className="h-4 w-4" />
                  </Button>
                } />
                <TooltipContent className="text-xs font-normal max-w-xs">
                  <p>
                    Choose who can discover and view your project on the Let&apos;s Assist platform.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={visibility}
            onValueChange={(value) =>
              updateVisibilityAction(value as ProjectVisibility)
            }
            className="grid gap-4"
          >
            {/* Public */}
            <label
              htmlFor="visibility-public"
              className={cn(
                "flex flex-col items-start space-y-3 rounded-lg border p-4 hover:bg-accent cursor-pointer transition-colors",
                visibility === "public" && "border-primary bg-accent",
                errors.visibility && "border-destructive",
              )}
            >
              <div className="flex w-full justify-between space-x-3">
                <div className="flex items-center space-x-3">
                  <RadioGroupItem value="public" id="visibility-public" />
                  <div className="flex items-center space-x-2">
                    <Eye className="h-5 w-5" />
                    <span className="font-medium">Public (Everyone)</span>
                  </div>
                </div>
                <Badge variant="default">Recommended</Badge>
              </div>
              <p className="text-sm text-muted-foreground ml-6">
                Your project appears on the home feed and in search results. Anyone on the platform can find and sign up for it.
              </p>
            </label>

            {/* Unlisted */}
            <label
              htmlFor="visibility-unlisted"
              className={cn(
                "flex flex-col items-start space-y-3 rounded-lg border p-4 hover:bg-accent cursor-pointer transition-colors",
                visibility === "unlisted" && "border-primary bg-accent",
                errors.visibility && "border-destructive",
              )}
            >
              <div className="flex w-full justify-between space-x-3">
                <div className="flex items-center space-x-3">
                  <RadioGroupItem value="unlisted" id="visibility-unlisted" />
                  <div className="flex items-center space-x-2">
                    <Link2 className="h-5 w-5" />
                    <span className="font-medium">Unlisted (By Link Only)</span>
                  </div>
                </div>
                <Badge variant="secondary">Private Link</Badge>
              </div>
              <p className="text-sm text-muted-foreground ml-6">
                Only people with the direct link can find your project. Share the link with volunteers via email or social media. Won&apos;t appear in search or feeds.
              </p>
            </label>

            {/* Organization Only - only show for organization projects */}
            {isOrganization && (
              <label
                htmlFor="visibility-org-only"
                className={cn(
                  "flex flex-col items-start space-y-3 rounded-lg border p-4 hover:bg-accent cursor-pointer transition-colors",
                  visibility === "organization_only" && "border-primary bg-accent",
                  errors.visibility && "border-destructive",
                )}
              >
                <div className="flex w-full justify-between space-x-3">
                  <div className="flex items-center space-x-3">
                    <RadioGroupItem value="organization_only" id="visibility-org-only" />
                    <div className="flex items-center space-x-2">
                      <Lock className="h-5 w-5" />
                      <span className="font-medium">Organization Members Only</span>
                    </div>
                  </div>
                  <Badge variant="secondary">Private</Badge>
                </div>
                <p className="text-sm text-muted-foreground ml-6">
                  Only your organization members can see and sign up for this project. Great for internal volunteer opportunities or member-exclusive events.
                </p>
              </label>
            )}
          </RadioGroup>

          {errors.visibility && (
            <div className="text-destructive text-sm flex items-center gap-2 mt-4">
              <AlertTriangle className="h-4 w-4" />
              {errors.visibility}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Domain Restriction Section - Only show if organization has allowed domains */}
      {isOrganization && allowedEmailDomains && allowedEmailDomains.length > 0 && updateRestrictToOrgDomainsAction && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Email Domain Requirements
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <Info className="h-4 w-4" />
                    </Button>
                  } />
                  <TooltipContent className="text-xs font-normal max-w-xs">
                    <p>
                      Optionally require volunteers to have an email from your organization&apos;s approved domains to sign up.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex items-center justify-between space-x-4">
                <div className="flex items-center space-x-3 flex-1">
                  <div
                    className={cn(
                      "p-2 rounded-md",
                      restrictToOrgDomains ? "bg-primary/10" : "bg-muted",
                    )}
                  >
                    {restrictToOrgDomains ? (
                      <Lock className="h-5 w-5 text-primary" />
                    ) : (
                      <Users className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <Label
                      htmlFor="restrict-domains"
                      className="text-base font-medium cursor-pointer"
                    >
                      Require Organization Email
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      {restrictToOrgDomains
                        ? `✓ Only emails from: ${allowedEmailDomains.join(", ")} can sign up`
                        : `Optional: Allow emails from any domain to sign up`}
                    </p>
                  </div>
                </div>
                <Switch
                  id="restrict-domains"
                  checked={restrictToOrgDomains}
                  onCheckedChange={updateRestrictToOrgDomainsAction}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
