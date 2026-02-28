import { z } from "zod";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError as FormMessage,
} from "@/components/ui/field";
import { Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, PenTool, Check, Clock, Settings2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DialogFooter } from "@/components/ui/dialog";
import { useEffect, useState, useCallback } from "react";
import type { WaiverSignatureInput, WaiverTemplate, WaiverDefinitionFull } from "@/types";
import { WaiverSigningDialog } from '@/components/waiver/WaiverSigningDialog';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { checkReusableAnonymousWaiver } from "./actions";

// Constants for phone validation
const PHONE_LENGTH = 10; // For raw digits
const PHONE_REGEX = /^\d{3}-\d{3}-\d{4}$/; // Format XXX-XXX-XXXX
const ANON_PROFILE_STORAGE_KEY = "letsassist.anonymous-signup-profile.v1";
const ANON_PROFILE_AUTO_APPLY_KEY = "letsassist.anonymous-signup-auto-apply.v1";
const ANON_WAIVER_CACHE_KEY = "letsassist.anonymous-signup-waiver-cache.v1";

interface SavedAnonymousProfile {
  name: string;
  email: string;
  phone?: string;
  updatedAt: string;
}

const formSchema = z.object({
  name: z.string().min(2, { message: "Name is required" }),
  email: z.string().email({ message: "Invalid email address" }),
  phone: z
    .string()
    .refine(
      // Validate against the XXX-XXX-XXXX format if a value exists
      (val) => !val || val === "" || PHONE_REGEX.test(val),
      "Phone number must be in format XXX-XXX-XXXX"
    )
    .transform((val) => {
      // Store only digits if validation passes
      if (!val || val === "") return undefined;
      return val.replace(/\D/g, ""); // Remove non-digit characters
    })
    .refine(
      // Ensure exactly 10 digits if a value exists
      (val) => !val || val.length === PHONE_LENGTH,
      `Phone number must contain exactly ${PHONE_LENGTH} digits.`
    )
    .optional() // Make the entire refined/transformed field optional
    .or(z.literal("").transform(() => undefined)),
  comment: z
    .string()
    .max(100, { message: "Comment must be 100 characters or less" })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

type FormValues = z.infer<typeof formSchema>;

interface ProjectFormProps {
  onSubmit: (data: FormValues, waiverSignature?: WaiverSignatureInput | null) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  showCommentField?: boolean;
  enableSavedInfoReuse?: boolean;
  projectId?: string;
  waiverRequired?: boolean;
  waiverAllowUpload?: boolean;
  waiverDisableEsignature?: boolean;
  waiverTemplate?: WaiverTemplate | null;
  waiverPdfUrl?: string | null;
  waiverDefinition?: WaiverDefinitionFull | null;
}

// Helper function to format phone number input
const formatPhoneNumber = (value: string): string => {
  if (!value) return value;
  const phoneNumber = value.replace(/[^\d]/g, ""); // Allow only digits
  const phoneNumberLength = phoneNumber.length;

  if (phoneNumberLength < 4) return phoneNumber;
  if (phoneNumberLength < 7) {
    return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3)}`;
  }
  return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
};

// Helper function to format relative time
const formatRelativeTime = (isoString: string): string => {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};


export function ProjectSignupForm({
  onSubmit,
  onCancel: _onCancel,
  isSubmitting,
  showCommentField = false,
  enableSavedInfoReuse = false,
  projectId,
  waiverRequired = false,
  waiverAllowUpload = true,
  waiverDisableEsignature = false,
  waiverTemplate = null,
  waiverPdfUrl = null,
  waiverDefinition = null,
}: ProjectFormProps) {
  // Mobile check for responsive layout if needed
  // Using simple responsive classes instead of hook
  const [phoneNumberLength, setPhoneNumberLength] = useState(0); // State for phone number length
  const [waiverSignature, setWaiverSignature] = useState<WaiverSignatureInput | null>(null);
  const [isWaiverDialogOpen, setIsWaiverDialogOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "", // Initialize as empty string for the input field
      comment: "",
    },
  });

  const [savedProfile, setSavedProfile] = useState<SavedAnonymousProfile | null>(null);
  const [usedSavedProfile, setUsedSavedProfile] = useState(false);
  const [autoApplyEnabled, setAutoApplyEnabled] = useState(false);
  const [lastUpdatedDisplay, setLastUpdatedDisplay] = useState<string>("");
  const [hasReusableWaiver, setHasReusableWaiver] = useState(false);
  const [hasLocallyCachedWaiver, setHasLocallyCachedWaiver] = useState(false);
  const [isCheckingReusableWaiver, setIsCheckingReusableWaiver] = useState(false);

  const watchedEmail = form.watch("email");
  const normalizedWatchedEmail = watchedEmail?.trim().toLowerCase() || "";
  const waiverCacheEntryKey = projectId && normalizedWatchedEmail
    ? `${projectId}:${normalizedWatchedEmail}`
    : "";

  const markWaiverCachedLocally = useCallback((email: string) => {
    if (typeof window === "undefined" || !projectId) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) return;

    const key = `${projectId}:${normalizedEmail}`;

    try {
      const raw = window.localStorage.getItem(ANON_WAIVER_CACHE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      parsed[key] = new Date().toISOString();
      window.localStorage.setItem(ANON_WAIVER_CACHE_KEY, JSON.stringify(parsed));

      if (key === waiverCacheEntryKey) {
        setHasLocallyCachedWaiver(true);
      }
    } catch {
      // Ignore storage errors silently.
    }
  }, [projectId, waiverCacheEntryKey]);

  const applySavedProfile = useCallback((profile: SavedAnonymousProfile) => {
    const formattedPhone = profile.phone ? formatPhoneNumber(profile.phone) : "";

    form.setValue("name", profile.name, { shouldValidate: true, shouldDirty: true });
    form.setValue("email", profile.email, { shouldValidate: true, shouldDirty: true });
    form.setValue("phone", formattedPhone, { shouldValidate: true, shouldDirty: true });
    setPhoneNumberLength(formattedPhone.replace(/-/g, "").length);
    setUsedSavedProfile(true);
  }, [form]);

  useEffect(() => {
    if (!enableSavedInfoReuse || typeof window === "undefined") return;

    try {
      // Load auto-apply preference
      const autoApplyStr = window.localStorage.getItem(ANON_PROFILE_AUTO_APPLY_KEY);
      const isAutoApply = autoApplyStr === "true";
      setAutoApplyEnabled(isAutoApply);

      const raw = window.localStorage.getItem(ANON_PROFILE_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as SavedAnonymousProfile;
      const isValid =
        parsed &&
        typeof parsed.name === "string" &&
        typeof parsed.email === "string" &&
        parsed.name.trim().length > 1 &&
        parsed.email.includes("@");

      if (isValid) {
        setSavedProfile(parsed);
        setLastUpdatedDisplay(formatRelativeTime(parsed.updatedAt));

        // Auto-apply if preference is enabled
        if (isAutoApply) {
          applySavedProfile(parsed);
        }
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
    if (!waiverRequired || !waiverCacheEntryKey || typeof window === "undefined") {
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

  useEffect(() => {
    if (!waiverRequired || !projectId || !normalizedWatchedEmail.includes("@")) {
      setHasReusableWaiver(false);
      setIsCheckingReusableWaiver(false);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setIsCheckingReusableWaiver(true);
      const result = await checkReusableAnonymousWaiver(projectId, normalizedWatchedEmail);

      if (cancelled) return;

      const reusable = !!result.hasReusableWaiver;
      setHasReusableWaiver(reusable);
      setIsCheckingReusableWaiver(false);

      if (reusable) {
        markWaiverCachedLocally(normalizedWatchedEmail);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [waiverRequired, projectId, normalizedWatchedEmail, markWaiverCachedLocally]);

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
    }
  };

  const persistProfileLocally = (data: FormValues) => {
    if (!enableSavedInfoReuse || typeof window === "undefined") return;

    const profile: SavedAnonymousProfile = {
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      phone: data.phone ? formatPhoneNumber(data.phone) : "",
      updatedAt: new Date().toISOString(),
    };

    try {
      window.localStorage.setItem(ANON_PROFILE_STORAGE_KEY, JSON.stringify(profile));
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

    if (waiverRequired && (waiverSignature || hasReusableWaiver)) {
      markWaiverCachedLocally(data.email);
    }

    onSubmit(data, waiverSignature);
  };

  const signerName = form.watch("name");
  const signerEmail = form.watch("email");
  const hasServerReusableWaiver = hasReusableWaiver;
  const waiverSatisfied = !waiverRequired || !!waiverSignature || hasServerReusableWaiver;

  const handleWaiverComplete = async (input: WaiverSignatureInput) => {
    setWaiverSignature(input);
    const signerEmail = (input.signerEmail || normalizedWatchedEmail || "").trim().toLowerCase();
    if (signerEmail) {
      markWaiverCachedLocally(signerEmail);
    }
    setIsWaiverDialogOpen(false);
  };


  return (
    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4">
      {enableSavedInfoReuse && savedProfile && (
        <Alert className="border-primary/20 bg-primary/5 p-4">
          <AlertDescription className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Use saved info for {savedProfile.email}
                </p>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Updated {lastUpdatedDisplay}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleApplyClick} className="h-8">
                  Use Saved Info
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={forgetSavedProfile} className="h-8">
                  Forget
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-primary/10">
              <div className="flex items-center gap-2">
                <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                <Label htmlFor="auto-apply" className="text-xs text-muted-foreground cursor-pointer">
                  Auto-apply for future signups
                </Label>
              </div>
              <Switch 
                id="auto-apply"
                checked={autoApplyEnabled}
                onCheckedChange={handleAutoApplyToggle}
                className="scale-75 origin-right"
              />
            </div>

            {usedSavedProfile && (
              <p className="text-xs text-success font-medium flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                <Check className="h-3 w-3" /> Info applied successfully
              </p>
            )}

            {waiverRequired && !usedSavedProfile && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                If this email already has a waiver for this project, we&apos;ll reuse it automatically.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Full Name</FieldLabel>
            <Input id={field.name} placeholder="Enter your name" {...field} aria-invalid={fieldState.invalid} />
            {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="email"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Email</FieldLabel>
            <Input id={field.name} placeholder="your@email.com" {...field} aria-invalid={fieldState.invalid} />
            {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="phone"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <div className="flex justify-between items-center">
              <FieldLabel htmlFor={field.name}>Phone Number (Optional)</FieldLabel>
              {/* Display character count */}
              <span
                className={`text-xs ${phoneNumberLength > PHONE_LENGTH ? "text-destructive font-semibold" : "text-muted-foreground"}`}
              >
                {phoneNumberLength}/{PHONE_LENGTH}
              </span>
            </div>
            <Input
              id={field.name}
              type="tel" // Use tel type for better mobile UX
              placeholder="555-555-5555"
              {...field}
              value={field.value || ""} // Ensure value is controlled, default to empty string if undefined/null
              onChange={(e) => {
                const formatted = formatPhoneNumber(e.target.value);
                field.onChange(formatted); // Update form with formatted value
                // Update length count based on digits only
                setPhoneNumberLength(formatted.replace(/-/g, "").length);
              }}
              maxLength={12} // Max length for XXX-XXX-XXXX format
              aria-invalid={fieldState.invalid}
            />
            {/* Add FormDescription */}
            {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
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
                <div className="flex justify-between items-center">
                  <FieldLabel htmlFor={field.name}>Comment (Optional)</FieldLabel>
                  <span className={`text-xs ${commentLength > 100 ? "text-destructive" : "text-muted-foreground"}`}>
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
                  className="resize-none text-sm"
                  aria-invalid={fieldState.invalid}
                />
                <FieldDescription className="text-xs">
                  Brief note visible to the organizer.
                </FieldDescription>
                {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
              </Field>
            );
          }}
        />
      )}

      {waiverRequired && (
        <div className="space-y-2 border rounded-md p-4 bg-secondary/10">
          <FieldLabel>Waiver Agreement</FieldLabel>
          <div className="text-sm text-muted-foreground mb-4">
            A signature is required to participate in this event.
          </div>

          {isCheckingReusableWaiver && (
            <p className="text-xs text-muted-foreground mb-3">Checking for an existing waiver on your anonymous profile...</p>
          )}

          {!waiverSignature && hasServerReusableWaiver && (
            <Alert className="mb-3 border-success/30 bg-success/5">
              <AlertDescription className="text-xs text-success">
                We found your latest signed waiver for this anonymous profile. You can submit without signing again.
              </AlertDescription>
            </Alert>
          )}

          {!waiverSignature && hasLocallyCachedWaiver && !hasServerReusableWaiver && (
            <Alert className="mb-3 border-primary/30 bg-primary/5">
              <AlertDescription className="text-xs text-primary">
                We found a recent waiver on this device, but it isn&apos;t confirmed on the server for this profile yet. Please sign again to continue.
              </AlertDescription>
            </Alert>
          )}
          
          {!waiverSignature ? (
             <Button 
               type="button" 
               onClick={() => setIsWaiverDialogOpen(true)}
               variant="outline"
               className="w-full sm:w-auto"
             >
               <PenTool className="h-4 w-4 mr-2" />
               {hasServerReusableWaiver ? "Review or Re-sign Waiver" : "Sign Waiver"}
             </Button>
          ) : (
             <div className="flex items-center justify-between p-3 bg-success/10 border border-success rounded-lg">
                <div className="flex items-center gap-2">
                   <div className="h-8 w-8 rounded-full bg-success/20 flex items-center justify-center text-success">
                      <Check className="h-4 w-4" />
                   </div>
                   <div className="text-sm font-medium text-success">
                      Signature Captured
                   </div>
                </div>
                <Button 
                   type="button" 
                   variant="ghost" 
                   size="sm"
                   onClick={() => setIsWaiverDialogOpen(true)}
                   className="text-muted-foreground hover:text-foreground"
                >
                   Review
                </Button>
             </div>
          )}

          <WaiverSigningDialog
            isOpen={isWaiverDialogOpen}
            onClose={() => setIsWaiverDialogOpen(false)}
            waiverDefinition={waiverDefinition}
            waiverPdfUrl={waiverPdfUrl}
            waiverTemplate={waiverTemplate}
            onComplete={handleWaiverComplete}
            defaultSignerName={signerName}
            defaultSignerEmail={signerEmail}
            allowUpload={waiverAllowUpload}
            disableEsignature={waiverDisableEsignature}
          />
        </div>
      )}

      <DialogFooter>
        <Button
          type="submit"
          disabled={isSubmitting || !waiverSatisfied}
        >
          {isSubmitting && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Sign Up
        </Button>
      </DialogFooter>
    </form>
  );
}