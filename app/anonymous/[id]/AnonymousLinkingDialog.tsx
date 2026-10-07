"use client";
import { safeConsole } from "@/lib/safe-console";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import {
  linkAnonymousToAuthenticatedAccount,
  linkAnonymousToExistingAccount,
  linkAnonymousToNewAccount,
  startAnonymousGoogleLink,
} from "./actions";
import { LinkIcon, useAnimatedIcon } from "@/components/icons/animated";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TurnstileComponent } from "@/components/ui/turnstile";
import { SecureCheckPanel } from "@/components/auth/SecureCheckPanel";
import { useBotVerification } from "@/hooks/useBotVerification";
import { shouldRenderTurnstileWidget } from "@/lib/anonymous-signup-security";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  CreateAccountForm,
  ExistingAccountForm,
} from "./_components/LinkingForms";
import {
  createAccountSchema,
  existingAccountSchema,
  type CreateAccountValues,
  type ExistingAccountValues,
} from "./_components/linking-schemas";
import { VerificationSentDialog } from "./_components/VerificationSentDialog";

type CurrentUserState = {
  id: string;
  email: string | null;
} | null;

interface AnonymousLinkingDialogProps {
  anonymousId: string;
  anonymousToken: string;
  defaultName: string;
  defaultEmail: string;
  isLinked: boolean;
  onLinked: () => void;
  onLinkedPendingVerification: (email: string) => void;
}

export function AnonymousLinkingDialog({
  anonymousId,
  anonymousToken,
  defaultName,
  defaultEmail,
  isLinked,
  onLinked,
  onLinkedPendingVerification,
}: AnonymousLinkingDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"existing" | "create">("existing");
  const [currentUser, setCurrentUser] = useState<CurrentUserState>(null);
  const [isLinkingCurrent, setIsLinkingCurrent] = useState(false);
  const [isLinkingExisting, setIsLinkingExisting] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [verificationDialogOpen, setVerificationDialogOpen] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState(defaultEmail);

  const linkIcon = useAnimatedIcon();

  const verification = useBotVerification({
    onError: () => {
      toast.error("Security verification failed. Please try again.");
    },
  });

  const showTurnstileWidget = shouldRenderTurnstileWidget({
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    bypass: process.env.NEXT_PUBLIC_TURNSTILE_BYPASS,
  });

  const existingAccountForm = useForm<ExistingAccountValues>({
    resolver: zodResolver(existingAccountSchema),
    defaultValues: {
      email: defaultEmail,
      password: "",
    },
  });

  const createAccountForm = useForm<CreateAccountValues>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: {
      fullName: defaultName,
      email: defaultEmail,
      password: "",
    },
  });

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    const syncCurrentUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) {
        return;
      }

      setCurrentUser(
        user
          ? {
              id: user.id,
              email: user.email ?? null,
            }
          : null,
      );
    };

    void syncCurrentUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(
        session?.user
          ? {
              id: session.user.id,
              email: session.user.email ?? null,
            }
          : null,
      );
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const requireCaptchaToken = () => {
    if (!showTurnstileWidget || verification.token) {
      return true;
    }

    toast.error("Please complete the security verification challenge.");
    return false;
  };

  const finishLinkedSession = (message: string) => {
    onLinked();
    toast.success(message);
    setOpen(false);
    router.replace("/dashboard");
    router.refresh();
  };

  const handleLinkCurrentAccount = async () => {
    setIsLinkingCurrent(true);

    try {
      const result = await linkAnonymousToAuthenticatedAccount(
        anonymousId,
        anonymousToken,
      );

      if (result.error) {
        toast.error(result.error);
        return;
      }

      finishLinkedSession(
        "Account linked successfully! Your volunteer dashboard is ready.",
      );
    } catch (error) {
      safeConsole.error("Error linking current account:", error);
      toast.error("Failed to link your current account. Please try again.");
    } finally {
      setIsLinkingCurrent(false);
    }
  };

  const handleExistingAccountLink = existingAccountForm.handleSubmit(
    async (values) => {
      if (!requireCaptchaToken()) {
        return;
      }

      setIsLinkingExisting(true);

      try {
        const result = await linkAnonymousToExistingAccount(
          anonymousId,
          anonymousToken,
          values.email,
          values.password,
          verification.token ?? undefined,
        );

        if (result.error) {
          toast.error(result.error);
          verification.reset();
          return;
        }

        existingAccountForm.reset({
          email: values.email,
          password: "",
        });
        finishLinkedSession(
          "Account linked successfully! Redirecting to your dashboard...",
        );
      } catch (error) {
        safeConsole.error("Error linking existing account:", error);
        toast.error("Failed to link your account. Please try again.");
        verification.reset();
      } finally {
        setIsLinkingExisting(false);
      }
    },
  );

  const handleCreateAccountLink = createAccountForm.handleSubmit(
    async (values) => {
      if (!requireCaptchaToken()) {
        return;
      }

      setIsCreatingAccount(true);

      try {
        const result = await linkAnonymousToNewAccount(
          anonymousId,
          anonymousToken,
          values.email,
          values.password,
          values.fullName,
          verification.token ?? undefined,
        );

        if (result.error) {
          toast.error(result.error);
          verification.reset();
          return;
        }

        createAccountForm.reset({
          fullName: values.fullName,
          email: values.email,
          password: "",
        });

        verification.reset();
        setOpen(false);

        if (result.requiresEmailVerification) {
          onLinkedPendingVerification(values.email);
          setVerificationEmail(values.email);
          setVerificationDialogOpen(true);
          toast.success(
            "Account created! Check your email to finish accessing your dashboard.",
          );
          return;
        }

        finishLinkedSession(
          "Account created and linked successfully! Redirecting to your dashboard...",
        );
      } catch (error) {
        safeConsole.error("Error creating linked account:", error);
        toast.error("Failed to create your account. Please try again.");
        verification.reset();
      } finally {
        setIsCreatingAccount(false);
      }
    },
  );

  const handleGoogleLink = async () => {
    setIsGoogleLoading(true);

    try {
      const result = await startAnonymousGoogleLink(
        anonymousId,
        anonymousToken,
      );

      if (!result.url || result.error) {
        toast.error(
          result.error ?? "Failed to start Google linking. Please try again.",
        );
        return;
      }

      window.location.assign(result.url);
    } catch (error) {
      safeConsole.error("Error starting Google linking:", error);
      toast.error("Failed to start Google linking. Please try again.");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      return;
    }

    existingAccountForm.clearErrors();
    createAccountForm.clearErrors();
    setActiveTab("existing");
    verification.reset();
  }, [createAccountForm, existingAccountForm, open, verification]);

  if (isLinked) {
    return null;
  }

  const isBusy =
    isLinkingCurrent ||
    isLinkingExisting ||
    isCreatingAccount ||
    isGoogleLoading;

  const formsBlocked = isBusy || (showTurnstileWidget && !verification.token);

  return (
    <>
      <div className="grid gap-2">
        <Button
          onClick={() => setOpen(true)}
          className="w-full sm:w-auto sm:justify-self-start"
          disabled={isBusy}
          {...linkIcon.triggerProps}
        >
          <LinkIcon
            ref={linkIcon.ref}
            size={16}
            data-icon="inline-start"
            aria-hidden="true"
          />
          Link or create account
        </Button>

        {currentUser?.email && (
          <p className="text-muted-foreground text-sm">
            You&apos;re already signed in as{" "}
            <span className="text-foreground font-medium wrap-break-word">
              {currentUser.email}
            </span>
            . Open the linker to attach this volunteer profile directly.
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Link this volunteer profile</DialogTitle>
            <DialogDescription>
              Move these anonymous volunteer signups into a Let&apos;s Assist
              account so you can track approvals, attendance, hours, and
              certificates in one place.
            </DialogDescription>
          </DialogHeader>

          {currentUser?.email && (
            <Alert variant="info">
              <AlertTitle>Already signed in</AlertTitle>
              <AlertDescription className="grid gap-3 [&_p:not(:last-child)]:mb-0">
                <p>
                  You&apos;re currently signed in as{" "}
                  <span className="text-foreground font-medium wrap-break-word">
                    {currentUser.email}
                  </span>
                  . You can attach this volunteer profile to that account
                  immediately.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleLinkCurrentAccount}
                  disabled={isBusy}
                  className="w-full sm:w-auto sm:justify-self-start"
                >
                  {isLinkingCurrent && (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  )}
                  Link to current account
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as "existing" | "create")
            }
            className="gap-4"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="existing">Existing account</TabsTrigger>
              <TabsTrigger value="create">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="existing">
              <ExistingAccountForm
                form={existingAccountForm}
                onSubmit={handleExistingAccountLink}
                disabled={formsBlocked}
                isSubmitting={isLinkingExisting}
              />
            </TabsContent>

            <TabsContent value="create">
              <CreateAccountForm
                form={createAccountForm}
                onSubmit={handleCreateAccountLink}
                disabled={formsBlocked}
                isSubmitting={isCreatingAccount}
              />
            </TabsContent>
          </Tabs>

          {showTurnstileWidget && (
            <div className="grid gap-3">
              <div className="grid gap-1">
                <h3 className="text-sm font-medium">Security check</h3>
                <p className="text-muted-foreground text-sm">
                  Complete bot verification before using email/password linking.
                </p>
              </div>
              <SecureCheckPanel
                phase={verification.phase}
                onRetry={verification.retry}
                className="rounded-lg"
                fallbackClassName="rounded-lg"
              >
                <TurnstileComponent
                  key={verification.widgetKey}
                  ref={verification.ref}
                  onLoad={verification.onLoad}
                  onVerify={verification.onVerify}
                  onError={verification.onError}
                  onExpire={() => verification.reset()}
                />
              </SecureCheckPanel>
              {verification.error && (
                <FieldError>{verification.error}</FieldError>
              )}
            </div>
          )}

          <Separator />

          <div className="grid gap-3">
            <div className="grid gap-1">
              <h3 className="text-sm font-medium">Prefer Google?</h3>
              <p className="text-muted-foreground text-sm">
                Supabase recommends redirect-based OAuth linking for Google.
                We&apos;ll bring you back here and finish attaching this profile
                automatically.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleLink}
              disabled={isBusy}
              className="w-full sm:w-auto sm:justify-self-start"
            >
              {isGoogleLoading ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Image
                  src="/resources/google-logo-2026.png"
                  alt=""
                  width={18}
                  height={18}
                  className="size-4 object-contain"
                />
              )}
              Continue with Google
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <VerificationSentDialog
        open={verificationDialogOpen}
        onOpenChange={setVerificationDialogOpen}
        email={verificationEmail}
      />
    </>
  );
}
