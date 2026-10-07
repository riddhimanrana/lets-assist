import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState, useCallback, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DialogFooter } from "@/components/ui/dialog";
import { TurnstileComponent, TurnstileRef } from "@/components/ui/turnstile";
import { SecureCheckPanel } from "@/components/auth/SecureCheckPanel";
import { useSecureCheck } from "@/hooks/useSecureCheck";
import { shouldRenderTurnstileWidget } from "@/lib/anonymous-signup-security";
import type {
  AnonymousSignupData,
  WaiverSignatureInput,
  WaiverDefinitionFull,
} from "@/types";
import { WaiverSigningDialog } from "@/components/waiver/WaiverSigningDialog";
import { ModernFormRenderer } from "@/components/forms/ModernFormRenderer";
import type { FormSchema } from "@/lib/forms/engine";
import {
  ProjectFormSavedInfo,
  ProjectFormWaiverField,
} from "./ProjectFormSavedInfo";
import {
  ANON_PROFILE_AUTO_APPLY_KEY,
  ANON_PROFILE_STORAGE_KEY,
  ANON_WAIVER_CACHE_KEY,
  LEGACY_ANON_PROFILE_STORAGE_KEYS,
  PHONE_LENGTH,
  formSchema,
  formatPhoneNumber,
  formatRelativeTime,
  loadSavedAnonymousProfile,
  type FormValues,
  type SavedAnonymousProfile,
} from "./signup-form-profile";

interface ProjectFormProps {
  onSubmit: (
    data: AnonymousSignupData,
    waiverSignature?: WaiverSignatureInput | null,
    formData?: Record<string, unknown>,
  ) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  showCommentField?: boolean;
  enableSavedInfoReuse?: boolean;
  projectId?: string;
  waiverRequired?: boolean;
  waiverAllowUpload?: boolean;
  waiverDisableEsignature?: boolean;
  waiverPdfUrl?: string | null;
  waiverDefinition?: WaiverDefinitionFull | null;
  signupFormSchema?: FormSchema | null;
}

export function ProjectSignupForm({
  onSubmit,
  onCancel,
  isSubmitting,
  showCommentField = false,
  enableSavedInfoReuse = false,
  projectId,
  waiverRequired = false,
  waiverAllowUpload = true,
  waiverDisableEsignature = false,
  waiverPdfUrl = null,
  waiverDefinition = null,
  signupFormSchema = null,
}: ProjectFormProps) {
  const [step, setStep] = useState<"anonymous-info" | "custom-form">(
    "anonymous-info",
  );
  const [pendingAnonData, setPendingAnonData] =
    useState<AnonymousSignupData | null>(null);
  const [pendingWaiverSignature, setPendingWaiverSignature] =
    useState<WaiverSignatureInput | null>(null);
  // Mobile check for responsive layout if needed
  // Using simple responsive classes instead of hook
  const [phoneNumberLength, setPhoneNumberLength] = useState(0); // State for phone number length
  const [waiverSignature, setWaiverSignature] =
    useState<WaiverSignatureInput | null>(null);
  const [isWaiverDialogOpen, setIsWaiverDialogOpen] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const secureCheck = useSecureCheck({
    onRetry: () => {
      setTurnstileToken(null);
      setTurnstileError(null);
    },
  });

  const showTurnstileWidget = shouldRenderTurnstileWidget({
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    bypass: process.env.NEXT_PUBLIC_TURNSTILE_BYPASS,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "", // Initialize as empty string for the input field
      comment: "",
    },
  });

  const [savedProfile, setSavedProfile] =
    useState<SavedAnonymousProfile | null>(null);
  const [usedSavedProfile, setUsedSavedProfile] = useState(false);
  const [autoApplyEnabled, setAutoApplyEnabled] = useState(false);
  const [lastUpdatedDisplay, setLastUpdatedDisplay] = useState<string>("");
  const [hasLocallyCachedWaiver, setHasLocallyCachedWaiver] = useState(false);

  const watchedEmail = form.watch("email");
  const normalizedWatchedEmail = watchedEmail?.trim().toLowerCase() || "";
  const waiverCacheEntryKey =
    projectId && normalizedWatchedEmail
      ? `${projectId}:${normalizedWatchedEmail}`
      : "";

  const markWaiverCachedLocally = useCallback(
    (email: string) => {
      if (typeof window === "undefined" || !projectId) return;

      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || !normalizedEmail.includes("@")) return;

      const key = `${projectId}:${normalizedEmail}`;

      try {
        const raw = window.localStorage.getItem(ANON_WAIVER_CACHE_KEY);
        const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
        parsed[key] = new Date().toISOString();
        window.localStorage.setItem(
          ANON_WAIVER_CACHE_KEY,
          JSON.stringify(parsed),
        );

        if (key === waiverCacheEntryKey) {
          setHasLocallyCachedWaiver(true);
        }
      } catch {
        // Ignore storage errors silently.
      }
    },
    [projectId, waiverCacheEntryKey],
  );

  const applySavedProfile = useCallback(
    (profile: SavedAnonymousProfile) => {
      form.setValue("name", profile.name, {
        shouldValidate: true,
        shouldDirty: true,
      });
      form.setValue("email", profile.email, {
        shouldValidate: true,
        shouldDirty: true,
      });
      setUsedSavedProfile(true);
    },
    [form],
  );

  useEffect(() => {
    if (!enableSavedInfoReuse || typeof window === "undefined") return;

    try {
      // Load auto-apply preference
      const autoApplyStr = window.localStorage.getItem(
        ANON_PROFILE_AUTO_APPLY_KEY,
      );
      const isAutoApply = autoApplyStr === "true";
      setAutoApplyEnabled(isAutoApply);

      const parsed = loadSavedAnonymousProfile();
      if (!parsed) return;

      setSavedProfile(parsed);
      setLastUpdatedDisplay(formatRelativeTime(parsed.updatedAt));

      // Auto-apply if preference is enabled
      if (isAutoApply) {
        applySavedProfile(parsed);
      }
    } catch {
      // Ignore parse/storage errors silently.
    }
  }, [enableSavedInfoReuse, applySavedProfile]);

  // Update relative time periodically
  useEffect(() => {
    if (!savedProfile) return;

    const interval = setInterval(() => {
      setLastUpdatedDisplay(formatRelativeTime(savedProfile.updatedAt));
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [savedProfile]);

  useEffect(() => {
    if (
      !waiverRequired ||
      !waiverCacheEntryKey ||
      typeof window === "undefined"
    ) {
      setHasLocallyCachedWaiver(false);
      return;
    }

    try {
      const raw = window.localStorage.getItem(ANON_WAIVER_CACHE_KEY);
      const cache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      setHasLocallyCachedWaiver(Boolean(cache[waiverCacheEntryKey]));
    } catch {
      setHasLocallyCachedWaiver(false);
    }
  }, [waiverRequired, waiverCacheEntryKey]);

  const handleApplyClick = () => {
    if (savedProfile) {
      applySavedProfile(savedProfile);
    }
  };

  const handleAutoApplyToggle = (enabled: boolean) => {
    setAutoApplyEnabled(enabled);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ANON_PROFILE_AUTO_APPLY_KEY, String(enabled));
    }
  };

  const forgetSavedProfile = () => {
    setSavedProfile(null);
    setUsedSavedProfile(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ANON_PROFILE_STORAGE_KEY);
      LEGACY_ANON_PROFILE_STORAGE_KEYS.forEach((storageKey) => {
        window.localStorage.removeItem(storageKey);
      });
    }
  };

  const persistProfileLocally = (data: FormValues) => {
    if (!enableSavedInfoReuse || typeof window === "undefined") return;

    const profile: SavedAnonymousProfile = {
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      updatedAt: new Date().toISOString(),
    };

    try {
      window.localStorage.setItem(
        ANON_PROFILE_STORAGE_KEY,
        JSON.stringify(profile),
      );
      setSavedProfile(profile);
    } catch {
      // Ignore storage quota/private mode issues silently.
    }
  };

  // Function to handle form submission, ensuring phone is transformed correctly
  const handleFormSubmit = (data: FormValues) => {
    // The data passed to onSubmit will already have the phone number transformed (digits only or undefined)
    // due to the zod schema's transform function.
    persistProfileLocally(data);

    const payload: AnonymousSignupData = {
      ...data,
      captchaToken: turnstileToken ?? undefined,
    };

    if (waiverRequired && waiverSignature) {
      markWaiverCachedLocally(data.email);
    }

    if (signupFormSchema) {
      setPendingAnonData(payload);
      setPendingWaiverSignature(waiverSignature);
      setStep("custom-form");
      return;
    }

    onSubmit(payload, waiverSignature);
  };

  const handleCustomFormSubmit = (data: Record<string, unknown>) => {
    if (pendingAnonData) {
      onSubmit(pendingAnonData, pendingWaiverSignature, data);
    }
  };

  const signerName = form.watch("name");
  const signerEmail = form.watch("email");
  const waiverSatisfied = !waiverRequired || !!waiverSignature;

  const handleWaiverComplete = async (input: WaiverSignatureInput) => {
    setWaiverSignature(input);
    const signerEmail = (input.signerEmail || normalizedWatchedEmail || "")
      .trim()
      .toLowerCase();
    if (signerEmail) {
      markWaiverCachedLocally(signerEmail);
    }
    setIsWaiverDialogOpen(false);
  };

  if (step === "custom-form" && signupFormSchema) {
    return (
      <div className="grid gap-4">
        <Button
          variant="ghost"
          onClick={() => setStep("anonymous-info")}
          className="-ml-2 justify-self-start"
        >
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          Back
        </Button>
        <ModernFormRenderer
          schema={signupFormSchema}
          title="Additional information"
          description="Please complete the following information required for this tournament."
          onSubmit={handleCustomFormSubmit}
          isSubmitting={isSubmitting}
          userEmail={pendingAnonData?.email}
        />
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="grid gap-6">
      <FieldGroup>
        {enableSavedInfoReuse && savedProfile && (
          <ProjectFormSavedInfo
            email={savedProfile.email}
            lastUpdatedDisplay={lastUpdatedDisplay}
            autoApplyEnabled={autoApplyEnabled}
            usedSavedProfile={usedSavedProfile}
            waiverRequired={waiverRequired}
            onApply={handleApplyClick}
            onForget={forgetSavedProfile}
            onAutoApplyChange={handleAutoApplyToggle}
          />
        )}

        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Full name</FieldLabel>
              <Input
                id={field.name}
                placeholder="Enter your name"
                autoComplete="name"
                {...field}
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Email</FieldLabel>
              <Input
                id={field.name}
                placeholder="your@email.com"
                autoComplete="email"
                {...field}
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="phone"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor={field.name}>
                  Phone number (optional)
                </FieldLabel>
                <span
                  className={
                    phoneNumberLength > PHONE_LENGTH
                      ? "text-destructive text-xs font-medium tabular-nums"
                      : "text-muted-foreground text-xs tabular-nums"
                  }
                >
                  {phoneNumberLength}/{PHONE_LENGTH}
                </span>
              </div>
              <Input
                id={field.name}
                type="tel"
                placeholder="555-555-5555"
                autoComplete="tel-national"
                {...field}
                value={field.value || ""}
                onChange={(e) => {
                  const formatted = formatPhoneNumber(e.target.value);
                  field.onChange(formatted);
                  // Count digits only, not the separators.
                  setPhoneNumberLength(formatted.replace(/-/g, "").length);
                }}
                maxLength={12}
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        {showCommentField && (
          <Controller
            control={form.control}
            name="comment"
            render={({ field, fieldState }) => {
              const commentLength = ((field.value as string) || "").length;
              return (
                <Field data-invalid={fieldState.invalid}>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor={field.name}>
                      Comment (optional)
                    </FieldLabel>
                    <span
                      className={
                        commentLength > 100
                          ? "text-destructive text-xs tabular-nums"
                          : "text-muted-foreground text-xs tabular-nums"
                      }
                    >
                      {commentLength}/100
                    </span>
                  </div>
                  <Textarea
                    id={field.name}
                    placeholder="Add a note for the organizer..."
                    {...field}
                    value={(field.value as string) || ""}
                    rows={2}
                    maxLength={100}
                    className="resize-none"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    Brief note visible to the organizer.
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              );
            }}
          />
        )}

        {waiverRequired && (
          <ProjectFormWaiverField
            hasSignature={Boolean(waiverSignature)}
            hasLocallyCachedWaiver={hasLocallyCachedWaiver}
            onOpen={() => setIsWaiverDialogOpen(true)}
          >
            <WaiverSigningDialog
              isOpen={isWaiverDialogOpen}
              onClose={() => setIsWaiverDialogOpen(false)}
              waiverDefinition={waiverDefinition}
              waiverPdfUrl={waiverPdfUrl}
              onComplete={handleWaiverComplete}
              defaultSignerName={signerName}
              defaultSignerEmail={signerEmail}
              allowUpload={waiverAllowUpload}
              disableEsignature={waiverDisableEsignature}
            />
          </ProjectFormWaiverField>
        )}

        {showTurnstileWidget && (
          <Field>
            <FieldLabel>Security check</FieldLabel>
            <FieldDescription>
              Complete bot verification before submitting your anonymous signup.
            </FieldDescription>
            <SecureCheckPanel
              phase={secureCheck.phase}
              onRetry={secureCheck.retry}
              className="w-75 rounded-lg"
              fallbackClassName="w-75 rounded-lg"
            >
              <TurnstileComponent
                action="anonymous-signup"
                key={secureCheck.widgetKey}
                ref={turnstileRef}
                onLoad={secureCheck.handleLoad}
                onVerify={(token) => {
                  setTurnstileError(null);
                  setTurnstileToken(token);
                }}
                onError={() => {
                  const wasReady = secureCheck.isReady;
                  secureCheck.handleError();
                  setTurnstileToken(null);

                  if (wasReady) {
                    turnstileRef.current?.reset();
                    setTurnstileError(
                      "Security verification failed. Please try again.",
                    );
                  }
                }}
                onExpire={() => {
                  setTurnstileError(
                    "Security verification expired. Please complete it again.",
                  );
                  setTurnstileToken(null);
                }}
              />
            </SecureCheckPanel>
            {turnstileError && (
              <p className="text-destructive text-sm" role="alert">
                {turnstileError}
              </p>
            )}
          </Field>
        )}
      </FieldGroup>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={
            isSubmitting ||
            !waiverSatisfied ||
            (showTurnstileWidget && !turnstileToken)
          }
        >
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Sign up
        </Button>
      </DialogFooter>
    </form>
  );
}
