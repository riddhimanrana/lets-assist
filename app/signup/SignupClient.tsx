"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signup, signInWithGoogle, resendVerificationEmail } from "./actions";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldLabel,
  FieldError as FormMessage,
} from "@/components/ui/field";
import { Controller } from "react-hook-form";
import { toast } from "sonner";
import { TurnstileComponent } from "@/components/ui/turnstile";
import { BotVerificationDialog } from "@/components/shared/BotVerificationDialog";
import { useBotVerification } from "@/hooks/useBotVerification";
import { useRouter } from "next/navigation";
import { getStaffInviteOrgLabel } from "@/lib/organization/staff-invite-outcome";
import { SecureCheckLoading } from "@/components/auth/SecureCheckLoading";

interface SignupClientProps {
  redirectPath?: string;
  staffToken?: string;
  orgUsername?: string;
  inviteToken?: string;
  prefilledEmail?: string;
  prefilledName?: string;
  prefilledPhone?: string;
}

const signupSchema = z.object({
  fullName: z.string().min(3, "Full name must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type SignupValues = z.infer<typeof signupSchema>;

export default function SignupClient({
  redirectPath,
  staffToken,
  orgUsername,
  inviteToken: _inviteToken,
  prefilledEmail,
  prefilledName,
  prefilledPhone,
}: SignupClientProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isResendCaptchaOpen, setIsResendCaptchaOpen] = useState(false);
  const [unconfirmedEmailForResend, setUnconfirmedEmailForResend] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);

  const verification = useBotVerification({
    onError: () => {
      toast.error("Security verification failed. Please try again.");
    },
  });

  const router = useRouter();
  const isStaffInvite = !!(staffToken && orgUsername);
  const normalizedPrefilledEmail = prefilledEmail?.trim() ?? "";
  const normalizedPrefilledName = prefilledName?.trim() ?? "";
  const normalizedPrefilledPhone = prefilledPhone?.trim() ?? "";

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: normalizedPrefilledName,
      email: normalizedPrefilledEmail,
      phone: normalizedPrefilledPhone,
      password: "",
    },
  });

  const handleResendWithCaptcha = async (token: string) => {
    if (!unconfirmedEmailForResend) {
      toast.error("Email address not found.");
      return;
    }

    setIsResending(true);
    try {
      const resendResult = await resendVerificationEmail(
        unconfirmedEmailForResend,
        token,
        redirectPath ?? null,
      );
      if (resendResult.success) {
        toast.success(resendResult.message || "Verification email sent!");
        const successUrl = new URL("/signup/success", window.location.origin);
        successUrl.searchParams.set("email", unconfirmedEmailForResend);
        if (redirectPath) {
          successUrl.searchParams.set("redirect", redirectPath);
        }
        router.push(`${successUrl.pathname}${successUrl.search}`);
        setIsResendCaptchaOpen(false);
      } else {
        toast.error(resendResult.error || "Failed to resend email");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  async function onSubmit(data: SignupValues) {
    const turnstileToken = verification.token;

    setIsLoading(true);
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => formData.append(key, value));
    if (redirectPath) {
      formData.append("redirectUrl", redirectPath);
    }

    if (turnstileToken) {
      formData.append("turnstileToken", turnstileToken);
    }

    if (staffToken) {
      formData.append("staffToken", staffToken);
    }
    if (orgUsername) {
      formData.append("orgUsername", orgUsername);
    }

    const result = await signup(formData);

    if (result.error) {
      const errors = result.error;

      if ('emailStatus' in result && result.emailStatus === 'confirmed') {
        const serverMessage = result.error?.server?.[0] || "An account with this email address already exists and is verified. Please log in to access your account.";
        toast.error("Account already exists", {
          description: serverMessage,
          action: {
            label: "Go to Login",
            onClick: () => router.push("/login"),
          },
        });
        setIsLoading(false);
        verification.reset();
        return;
      }

      if ('emailStatus' in result && result.emailStatus === 'unconfirmed' && 'email' in result) {
        const unconfirmedEmail = result.email as string;
        const serverMessage = result.error?.server?.[0] || "It looks like you already signed up but haven't confirmed your email yet.";

        toast.warning("Email Verification Pending", {
          description: serverMessage,
          action: {
            label: "Resend Email",
            onClick: () => {
              setUnconfirmedEmailForResend(unconfirmedEmail);
              setIsResendCaptchaOpen(true);
            },
          },
        });
        setIsLoading(false);
        verification.reset();
        return;
      }

      Object.keys(errors).forEach((key) => {
        if (key in signupSchema.shape) {
          form.setError(key as keyof SignupValues, {
            type: "server",
            message: errors[key as keyof typeof errors]?.[0],
          });
        } else if (key !== "server") {
          toast.error(`Error: ${errors[key as keyof typeof errors]?.[0]}`);
        }
      });

      if ("server" in errors && errors.server) {
        toast.error(errors.server[0]);
      }
    } else if (result.success && result.email) {
      if (result.inviteOutcome && result.inviteOutcome.status !== 'success') {
        const { status } = result.inviteOutcome;
        const orgLabel = getStaffInviteOrgLabel(result.inviteOutcome);
        let warningMessage = 'Could not join organization from invite.';
        
        switch (status) {
          case 'invalid_token':
            warningMessage = `The invite link for "${orgLabel}" is no longer valid.`;
            break;
          case 'expired_token':
            warningMessage = `The invite link for "${orgLabel}" has expired.`;
            break;
          case 'org_not_found':
            warningMessage = `The organization "${orgLabel}" could not be found.`;
            break;
          case 'error':
            warningMessage = `An error occurred while processing your invite to "${orgLabel}".`;
            break;
        }
        
        toast.warning('Account created, but invite failed', {
          description: warningMessage + ' Your account was created successfully.',
          duration: 5000,
        });
      }
      
      const successUrl = new URL("/signup/success", window.location.origin);
      successUrl.searchParams.set("email", result.email);
      if (redirectPath) {
        successUrl.searchParams.set("redirect", redirectPath);
      }
      router.push(`${successUrl.pathname}${successUrl.search}`);
      return;
    }

    setIsLoading(false);
    verification.reset();
  }

  const handleGoogleSignIn = async () => {
    try {
      setIsGoogleLoading(true);
      const inviteContext = (staffToken || orgUsername)
        ? { staffToken, orgUsername }
        : null;
      
      const result = await signInWithGoogle(redirectPath ?? null, inviteContext);

      if (result.error) {
        if (result.error.server?.[0]?.includes("email-password")) {
          toast.error(
            "This email is registered with password. Please sign in with email and password.",
          );
        } else {
          toast.error("Failed to connect with Google. Please try again.");
        }
        return;
      }

      if (result.url) {
        window.location.href = result.url;
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <section className="relative isolate flex min-h-[calc(100svh-4.5rem)] items-center justify-center overflow-hidden bg-background px-4 py-10 shadow-[inset_0_1px_0_hsl(var(--border))] sm:px-6 lg:px-8">

      <Card className="relative mx-auto w-full max-w-[430px] gap-0 overflow-hidden rounded-2xl border border-border/70 bg-card/95 py-0 shadow-[0_16px_44px_rgba(0,0,0,0.12),0_1px_6px_rgba(0,0,0,0.04)] ring-0 backdrop-blur-xl">
        <CardHeader className="space-y-2 px-6 pt-6 pb-0 sm:px-7">
          <CardTitle className="text-left text-2xl font-semibold tracking-tight">
            {isStaffInvite ? "Staff Invite" : "Create an account"}
          </CardTitle>
          <CardDescription className="text-left text-sm leading-5">
            {isStaffInvite
              ? `You've been invited to join as staff. Create your account to continue.`
              : redirectPath
                ? "Sign up to continue with your project signup"
                : "Enter your details below to create your account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-6 sm:p-7 sm:pt-6">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3.5">
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full rounded-full border-border/80 bg-background/80 font-semibold shadow-xs hover:border-primary/30 hover:bg-primary/5"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
            >
              {isGoogleLoading ? (
                "Connecting..."
              ) : (
                <>
                  <Image
                    src="/resources/google-logo-2026.png"
                    alt=""
                    width={18}
                    height={18}
                    className="mr-2 h-4.5 w-4.5 object-contain"
                  />
                  Continue with Google
                </>
              )}
            </Button>
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/80" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-3 font-semibold tracking-wide text-muted-foreground/80">
                  Or continue with
                </span>
              </div>
            </div>
            <Controller
              control={form.control}
              name="fullName"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name} className="text-[13px] font-semibold">
                    Full Name
                    {normalizedPrefilledName && (
                      <span className="ml-2 text-xs text-muted-foreground font-normal italic">
                        (auto-filled by org admin)
                      </span>
                    )}
                  </FieldLabel>
                  <Input
                    id={field.name}
                    placeholder="John Doe"
                    {...field}
                    aria-invalid={fieldState.invalid}
                    className="h-10 rounded-xl border-border/80 bg-muted/35 px-4 shadow-none focus-visible:bg-background"
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="email"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name} className="text-[13px] font-semibold">
                    Email
                    {normalizedPrefilledEmail && (
                      <span className="ml-2 text-xs text-muted-foreground font-normal italic">
                        (auto-filled by org admin)
                      </span>
                    )}
                  </FieldLabel>
                  <Input
                    id={field.name}
                    placeholder="m@example.com"
                    {...field}
                    aria-invalid={fieldState.invalid}
                    className="h-10 rounded-xl border-border/80 bg-muted/35 px-4 shadow-none focus-visible:bg-background"
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="phone"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name} className="text-[13px] font-semibold">
                    Phone Number (Optional)
                    {normalizedPrefilledPhone && (
                      <span className="ml-2 text-xs text-muted-foreground font-normal italic">
                        (auto-filled by org admin)
                      </span>
                    )}
                  </FieldLabel>
                  <Input
                    id={field.name}
                    placeholder="+1 555-1234"
                    {...field}
                    aria-invalid={fieldState.invalid}
                    className="h-10 rounded-xl border-border/80 bg-muted/35 px-4 shadow-none focus-visible:bg-background"
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="password"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name} className="text-[13px] font-semibold">
                    Password
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="password"
                    {...field}
                    aria-invalid={fieldState.invalid}
                    className="h-10 rounded-xl border-border/80 bg-muted/35 px-4 shadow-none focus-visible:bg-background"
                  />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                  <div className="mt-2.5">
                    <div className="rounded-xl border border-warning/25 bg-warning/10 p-3 shadow-xs">
                      <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-warning">
                        <AlertCircle className="h-4 w-4" />
                        Password Requirements
                      </p>
                      <ul className="space-y-1.5 text-xs text-warning/90">
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>At least 8 characters long</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>Cannot be a commonly used or compromised password</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </Field>
              )}
            />
            <div className="flex justify-center">
              <div className="relative flex h-16.25 w-full max-w-75 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-background">
                {!verification.isReady && <SecureCheckLoading />}
                <TurnstileComponent
                  ref={verification.ref}
                  onLoad={verification.onLoad}
                  onVerify={verification.onVerify}
                  onError={verification.onError}
                  onExpire={() => verification.reset()}
                />
              </div>
            </div>
            <Button
              type="submit"
              className="h-10 w-full rounded-full bg-primary font-semibold text-primary-foreground shadow-none hover:bg-primary/90"
              disabled={isLoading || !verification.isReady}
            >
              {isLoading ? "Creating Account..." : "Create Account"}
            </Button>
            <div className="pt-1 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href={(() => {
                  const params = new URLSearchParams();
                  if (redirectPath) {
                    params.set("redirect", redirectPath);
                  }
                  if (staffToken) {
                    params.set("staff_token", staffToken);
                  }
                  if (orgUsername) {
                    params.set("org", orgUsername);
                  }
                  if (normalizedPrefilledEmail) {
                    params.set("email", normalizedPrefilledEmail);
                  }
                  const query = params.toString();
                  return query ? `/login?${query}` : "/login";
                })()}
                className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80"
              >
                Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <BotVerificationDialog
        isOpen={isResendCaptchaOpen}
        onClose={() => setIsResendCaptchaOpen(false)}
        onVerified={handleResendWithCaptcha}
        title="Verify before resending"
        description="Complete the verification challenge so we can safely send a fresh confirmation link to your email."
        submitLabel="Verify & Send"
        isLoading={isResending}
        isSingleStep={true}
      />
    </section>
  );
}
