"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircle2,
  Link2,
  Loader2,
  LogIn,
  Mail,
  Shield,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import {
  linkAnonymousToAuthenticatedAccount,
  linkAnonymousToExistingAccount,
  linkAnonymousToNewAccount,
  startAnonymousGoogleLink,
} from "./actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TurnstileComponent } from "@/components/ui/turnstile";
import { useBotVerification } from "@/hooks/useBotVerification";
import { shouldRenderTurnstileWidget } from "@/lib/anonymous-signup-security";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const existingAccountSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const createAccountSchema = z.object({
  fullName: z.string().min(3, "Full name must be at least 3 characters"),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type ExistingAccountValues = z.infer<typeof existingAccountSchema>;
type CreateAccountValues = z.infer<typeof createAccountSchema>;

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

      finishLinkedSession("Account linked successfully! Your volunteer dashboard is ready.");
    } catch (error) {
      console.error("Error linking current account:", error);
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
        finishLinkedSession("Account linked successfully! Redirecting to your dashboard...");
      } catch (error) {
        console.error("Error linking existing account:", error);
        toast.error("Failed to link your account. Please try again.");
        verification.reset();
      } finally {
        setIsLinkingExisting(false);
      }
    },
  );

  const handleCreateAccountLink = createAccountForm.handleSubmit(async (values) => {
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
        toast.success("Account created! Check your email to finish accessing your dashboard.");
        return;
      }

      finishLinkedSession("Account created and linked successfully! Redirecting to your dashboard...");
    } catch (error) {
      console.error("Error creating linked account:", error);
      toast.error("Failed to create your account. Please try again.");
      verification.reset();
    } finally {
      setIsCreatingAccount(false);
    }
  });

  const handleGoogleLink = async () => {
    setIsGoogleLoading(true);

    try {
      const result = await startAnonymousGoogleLink(anonymousId, anonymousToken);

      if (!result.url || result.error) {
        toast.error(result.error ?? "Failed to start Google linking. Please try again.");
        return;
      }

      window.location.assign(result.url);
    } catch (error) {
      console.error("Error starting Google linking:", error);
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

  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => setOpen(true)} className="flex items-center gap-2" disabled={isBusy}>
            <Link2 className="h-4 w-4" />
            Link or Create Account
          </Button>
        </div>

        {currentUser?.email && (
          <p className="text-xs text-muted-foreground">
            You&apos;re already signed in as <span className="font-medium text-foreground">{currentUser.email}</span>. Open the linker to attach this volunteer profile directly.
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Link this volunteer profile</DialogTitle>
            <DialogDescription>
              Move these anonymous volunteer signups into a Let&apos;s Assist account so you can track approvals, attendance, hours, and certificates in one place.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {currentUser?.email && (
              <Alert className="border-primary/30 bg-primary/5">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Already signed in</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>
                    You&apos;re currently signed in as <span className="font-medium text-foreground">{currentUser.email}</span>. You can attach this volunteer profile to that account immediately.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLinkCurrentAccount}
                    disabled={isBusy}
                    className="w-full sm:w-auto"
                  >
                    {isLinkingCurrent ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="mr-2 h-4 w-4" />
                    )}
                    Link to Current Account
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "existing" | "create")}> 
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="existing">Existing account</TabsTrigger>
                <TabsTrigger value="create">Create account</TabsTrigger>
              </TabsList>

              <TabsContent value="existing" className="pt-4">
                <form onSubmit={handleExistingAccountLink} className="space-y-4">
                  <Controller
                    control={existingAccountForm.control}
                    name="email"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                        <Input id={field.name} type="email" placeholder="you@example.com" {...field} aria-invalid={fieldState.invalid} />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />

                  <Controller
                    control={existingAccountForm.control}
                    name="password"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                        <Input id={field.name} type="password" placeholder="Enter your password" {...field} aria-invalid={fieldState.invalid} />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />

                  <Button type="submit" className="w-full sm:w-auto" disabled={isBusy || (showTurnstileWidget && !verification.token)}>
                    {isLinkingExisting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="mr-2 h-4 w-4" />
                    )}
                    Sign In & Link
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="create" className="pt-4">
                <form onSubmit={handleCreateAccountLink} className="space-y-4">
                  <Controller
                    control={createAccountForm.control}
                    name="fullName"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>Full name</FieldLabel>
                        <Input id={field.name} placeholder="Your full name" {...field} aria-invalid={fieldState.invalid} />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />

                  <Controller
                    control={createAccountForm.control}
                    name="email"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                        <Input id={field.name} type="email" placeholder="you@example.com" {...field} aria-invalid={fieldState.invalid} />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />

                  <Controller
                    control={createAccountForm.control}
                    name="password"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                        <Input id={field.name} type="password" placeholder="Create a password" {...field} aria-invalid={fieldState.invalid} />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />

                  <Button type="submit" className="w-full sm:w-auto" disabled={isBusy || (showTurnstileWidget && !verification.token)}>
                    {isCreatingAccount ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="mr-2 h-4 w-4" />
                    )}
                    Create & Link
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            {showTurnstileWidget && (
              <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Security check</p>
                    <p className="text-xs text-muted-foreground">
                      Complete bot verification before using email/password linking.
                    </p>
                  </div>
                </div>

                <div className="flex justify-center">
                  <div className="relative flex h-16.25 w-75 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-background/80">
                    {!verification.isReady && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg bg-background/80 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Shield className="h-4 w-4 text-muted-foreground/80" />
                        <span className="text-[0.7rem] font-semibold normal-case">
                          Bot verification loading…
                        </span>
                      </div>
                    )}

                    <TurnstileComponent
                      ref={verification.ref}
                      onLoad={verification.onLoad}
                      onVerify={verification.onVerify}
                      onError={verification.onError}
                      onExpire={() => verification.reset()}
                    />
                  </div>
                </div>

                {verification.error && <FieldError>{verification.error}</FieldError>}
              </div>
            )}

            <div className="space-y-3 rounded-lg border border-border/60 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Prefer Google?</p>
                <p className="text-xs text-muted-foreground">
                  Supabase recommends redirect-based OAuth linking for Google. We&apos;ll bring you back here and finish attaching this profile automatically.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={handleGoogleLink} disabled={isBusy} className="w-full sm:w-auto">
                {isGoogleLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="mr-2 h-4 w-4" />
                )}
                Continue with Google
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isBusy}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={verificationDialogOpen} onOpenChange={setVerificationDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Check your email to finish account access</DialogTitle>
            <DialogDescription>
              We created your account and linked this volunteer profile. Verify <span className="font-medium text-foreground">{verificationEmail}</span>, then sign in to access your dashboard.
            </DialogDescription>
          </DialogHeader>

          <Alert className="border-primary/30 bg-primary/5">
            <Mail className="h-4 w-4" />
            <AlertTitle>What happens next</AlertTitle>
            <AlertDescription className="space-y-1 text-sm">
              <p>Your volunteer signups are already attached to the new account.</p>
              <p>Once you verify the email address, you&apos;ll be able to sign in and manage hours, attendance, and certificates from your dashboard.</p>
            </AlertDescription>
          </Alert>

          <DialogFooter className="gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setVerificationDialogOpen(false)}>
              Close
            </Button>
            <Button asChild>
              <Link href="/login">Go to Login</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
