"use client";
import { safeConsole } from "@/lib/safe-console";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Image from "next/image";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError as FormMessage,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import {
  initialOnboardingSchema,
  InitialOnboardingValues,
} from "@/schemas/onboarding-schema";
import { useState, useEffect, useRef } from "react";
import { completeInitialOnboarding } from "./onboarding-actions";
import {
  firstAvailableUsername,
  usernameCandidatesFromIdentity,
} from "./username-suggestions";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  CircleCheck,
  XCircle,
  Building2,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { usePathname, useRouter } from "next/navigation";

// Constants for validation
const _USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const PHONE_LENGTH = 10;

interface InitialOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  currentFullName?: string | null;
  currentEmail?: string | null;
  autoJoinedOrg?: { id: string; name: string } | null;
  /**
   * "csf" only swaps the heading/description copy for students arriving from
   * a CSF cohort connect link and keeps them on the connect page afterwards.
   */
  variant?: "default" | "csf";
}

export default function InitialOnboardingModal({
  isOpen,
  onClose,
  userId: _userId,
  currentFullName,
  currentEmail,
  autoJoinedOrg,
  variant = "default",
}: InitialOnboardingModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(
    null,
  );
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameLength, setUsernameLength] = useState(0);
  const [phoneNumberLength, setPhoneNumberLength] = useState(0);
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch org logo if auto-joined
  useEffect(() => {
    if (autoJoinedOrg?.id) {
      const supabase = createClient();
      supabase
        .from("organizations")
        .select("logo_url")
        .eq("id", autoJoinedOrg.id)
        .single()
        .then(({ data }) => {
          if (data?.logo_url) {
            setOrgLogoUrl(data.logo_url);
          }
        });
    }
  }, [autoJoinedOrg?.id]);

  const form = useForm<InitialOnboardingValues>({
    resolver: zodResolver(initialOnboardingSchema),
    defaultValues: {
      username: "",
      phoneNumber: "",
    },
  });

  const usernameValue = form.watch("username");
  const phoneValue = form.watch("phoneNumber");
  const usernameRequestIdRef = useRef(0);

  useEffect(() => {
    setUsernameLength(usernameValue?.length || 0);
  }, [usernameValue]);

  useEffect(() => {
    const digitsOnly = phoneValue?.replace(/\D/g, "") || "";
    setPhoneNumberLength(digitsOnly.length);
  }, [phoneValue]);

  async function checkUsernameAvailability(rawUsername: string) {
    const username = rawUsername.trim();
    if (username.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    const requestId = ++usernameRequestIdRef.current;
    setCheckingUsername(true);
    try {
      const res = await fetch(
        `/api/check-username?username=${encodeURIComponent(username)}`,
      );
      if (!res.ok) throw new Error("Failed to check username");
      const data = await res.json();

      // Ignore stale responses when user keeps typing.
      if (requestId !== usernameRequestIdRef.current) {
        return;
      }

      setUsernameAvailable(data.available);
      if (!data.available && data.error) {
        form.setError("username", {
          type: "manual",
          message: data.error,
        });
      } else {
        form.clearErrors("username");
      }
    } catch (error) {
      if (requestId === usernameRequestIdRef.current) {
        safeConsole.error("Error checking username:", error);
        setUsernameAvailable(null);
      }
    } finally {
      if (requestId === usernameRequestIdRef.current) {
        setCheckingUsername(false);
      }
    }
  }

  // Suggest a username from the entered name, but never overwrite a typed value.
  const suggestedUsernameRef = useRef(false);
  useEffect(() => {
    if (suggestedUsernameRef.current) return;
    if (!isOpen) return;
    if (form.getValues("username")) return;
    suggestedUsernameRef.current = true;

    const candidates = usernameCandidatesFromIdentity(
      currentFullName,
      currentEmail,
    );
    if (!candidates.length) return;

    let cancelled = false;
    void firstAvailableUsername(candidates, async (candidate) => {
      const res = await fetch(
        `/api/check-username?username=${encodeURIComponent(candidate)}`,
      );
      if (!res.ok) throw new Error("Failed to check username");
      const data = await res.json();
      return data.available === true;
    }).then((picked) => {
      // Still empty: a student who typed while we were checking keeps theirs.
      if (cancelled || !picked || form.getValues("username")) return;
      form.setValue("username", picked, { shouldValidate: true });
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, currentFullName, currentEmail, form]);

  useEffect(() => {
    if (!usernameValue) {
      setUsernameAvailable(null);
      return;
    }

    const timeout = setTimeout(() => {
      void checkUsernameAvailability(usernameValue);
    }, 300);

    return () => clearTimeout(timeout);
  }, [usernameValue]);

  async function handleUsernameBlur(e: React.FocusEvent<HTMLInputElement>) {
    const username = e.target.value.trim();
    if (username.length < 3) {
      setUsernameAvailable(null);
      return;
    }
    await checkUsernameAvailability(username);
  }

  const formatPhoneNumber = (value: string): string => {
    if (!value) return value;
    const phoneNumber = value.replace(/[^\d]/g, "");
    const phoneNumberLength = phoneNumber.length;

    if (phoneNumberLength < 4) return phoneNumber;
    if (phoneNumberLength < 7) {
      return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3)}`;
    }
    return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
  };

  async function onSubmit(values: InitialOnboardingValues) {
    setIsSubmitting(true);

    if (checkingUsername) {
      toast.error("Username availability is still being checked.");
      setIsSubmitting(false);
      return;
    }

    if (usernameAvailable === false) {
      toast.error(
        "Username not available. Please choose a different username.",
      );
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await completeInitialOnboarding(
        values.username,
        values.phoneNumber,
      );

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Welcome to Let's Assist! Your profile has been set up.");

        const supabase = createClient();
        let retries = 0;
        const maxRetries = 5;

        const waitForMetadataUpdate = async (): Promise<boolean> => {
          try {
            const {
              data: { user },
              error,
            } = await supabase.auth.getUser();
            if (error) {
              safeConsole.warn(
                "Error fetching updated user after onboarding:",
                error,
              );
              return false;
            }

            const metadata = user?.user_metadata as
              Record<string, unknown> | undefined;
            const hasCompletedOnboarding =
              metadata?.has_completed_onboarding === true;

            if (hasCompletedOnboarding) {
              const autoJoinedOrgName =
                typeof metadata?.auto_joined_org_name === "string"
                  ? metadata.auto_joined_org_name
                  : undefined;
              if (autoJoinedOrgName) {
                setTimeout(() => {
                  toast.info(
                    `You've been automatically added to ${autoJoinedOrgName} based on your email domain.`,
                    {
                      duration: 6000,
                    },
                  );
                }, 1500);
              }
              return true;
            }

            if (retries < maxRetries) {
              retries++;
              await new Promise((resolve) => setTimeout(resolve, 1000));
              return await waitForMetadataUpdate();
            }

            return false;
          } catch {
            return false;
          }
        };

        await waitForMetadataUpdate();
        onClose();

        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(
            "lets-assist:onboarding-complete",
            "true",
          );
        }

        setTimeout(() => {
          // CSF connect signups stay on the connect/confirmation page instead
          // of being pulled to /home.
          router.replace(
            variant === "csf" && pathname
              ? `${pathname}?onboarding=complete`
              : "/home?onboarding=complete",
          );
        }, 1000);
      }
    } catch (error) {
      safeConsole.error("Onboarding submission error:", error);
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false}>
        {mounted && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <Image
                  src="/logo.png"
                  alt=""
                  width={40}
                  height={40}
                  className="size-10 shrink-0"
                />
                <div className="grid min-w-0 gap-1">
                  <DialogTitle className="text-lg leading-snug font-semibold">
                    {variant === "csf"
                      ? "Finish setting up your Let's Assist account"
                      : "Welcome to Let's Assist!"}
                  </DialogTitle>
                  <DialogDescription>
                    {variant === "csf"
                      ? "Choose a username to finish setup and continue to CSF."
                      : "Let's set up your profile"}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {/* Auto-joined organization banner */}
            {autoJoinedOrg && (
              <Item variant="outline" size="sm">
                <ItemMedia>
                  <Avatar className="size-9">
                    <AvatarImage src={orgLogoUrl || undefined} alt="" />
                    <AvatarFallback>
                      <Building2
                        aria-hidden="true"
                        className="text-muted-foreground size-4"
                      />
                    </AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemDescription className="text-xs">
                    You&apos;ve been added to
                  </ItemDescription>
                  <ItemTitle className="block w-full truncate">
                    {autoJoinedOrg.name}
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Badge variant="success">Joined</Badge>
                </ItemActions>
              </Item>
            )}

            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
              <FieldGroup className="gap-4">
                <Controller
                  control={form.control}
                  name="username"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <div className="flex items-baseline justify-between gap-2">
                        <FieldLabel htmlFor={field.name}>
                          Choose your username
                        </FieldLabel>
                        <span
                          className={cn(
                            "text-xs tabular-nums",
                            usernameLength > USERNAME_MAX_LENGTH
                              ? "text-destructive font-medium"
                              : "text-muted-foreground",
                          )}
                        >
                          {usernameLength}/{USERNAME_MAX_LENGTH}
                        </span>
                      </div>
                      <InputGroup>
                        <InputGroupInput
                          id={field.name}
                          placeholder="username"
                          {...field}
                          maxLength={USERNAME_MAX_LENGTH}
                          aria-invalid={fieldState.invalid}
                          onChange={(e) => {
                            const noSpaces = e.target.value.replace(/\s/g, "");
                            const lower = noSpaces.toLowerCase();
                            field.onChange(lower);
                            setUsernameLength(lower.length);
                            // Clear errors and reset availability when typing
                            if (form.formState.errors.username) {
                              form.clearErrors("username");
                            }
                            setUsernameAvailable(null);
                          }}
                          onBlur={(e) => {
                            field.onBlur();
                            handleUsernameBlur(e);
                          }}
                        />
                        {checkingUsername ? (
                          <InputGroupAddon align="inline-end">
                            <Loader2
                              aria-label="Checking username"
                              className="animate-spin"
                            />
                          </InputGroupAddon>
                        ) : usernameAvailable !== null ? (
                          <InputGroupAddon align="inline-end">
                            {usernameAvailable ? (
                              <CircleCheck
                                aria-label="Username available"
                                className="text-success"
                              />
                            ) : (
                              <XCircle
                                aria-label="Username unavailable"
                                className="text-destructive"
                              />
                            )}
                          </InputGroupAddon>
                        ) : null}
                      </InputGroup>
                      <FieldDescription>
                        Letters, numbers, underscores, dots, and hyphens only (3
                        characters min)
                      </FieldDescription>
                      {fieldState.invalid && (
                        <FormMessage errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="phoneNumber"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <div className="flex items-baseline justify-between gap-2">
                        <FieldLabel htmlFor={field.name}>
                          Phone number{" "}
                          <span className="text-muted-foreground font-normal">
                            (optional)
                          </span>
                        </FieldLabel>
                        <span
                          className={cn(
                            "text-xs tabular-nums",
                            phoneNumberLength > PHONE_LENGTH
                              ? "text-destructive font-medium"
                              : "text-muted-foreground",
                          )}
                        >
                          {phoneNumberLength}/{PHONE_LENGTH}
                        </span>
                      </div>
                      <Input
                        id={field.name}
                        type="tel"
                        placeholder="XXX-XXX-XXXX"
                        {...field}
                        value={field.value || ""}
                        onChange={(e) => {
                          const formatted = formatPhoneNumber(e.target.value);
                          field.onChange(formatted);
                          setPhoneNumberLength(
                            formatted.replace(/-/g, "").length,
                          );
                        }}
                        maxLength={12}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldDescription>
                        Used for project coordination and volunteer signups
                      </FieldDescription>
                      {fieldState.invalid && (
                        <FormMessage errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              </FieldGroup>

              <DialogFooter>
                <Button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    checkingUsername ||
                    usernameAvailable !== true
                  }
                  className="w-full sm:w-auto"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2
                        data-icon="inline-start"
                        aria-hidden="true"
                        className="animate-spin"
                      />
                      Setting up your profile...
                    </>
                  ) : (
                    <>
                      Get started
                      <ArrowRight data-icon="inline-end" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
