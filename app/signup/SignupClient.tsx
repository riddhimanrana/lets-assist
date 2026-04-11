"use client";

import { Shield, AlertCircle, CheckCircle2 } from "lucide-react";
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

interface SignupClientProps {
  redirectPath?: string;
  staffToken?: string;
  orgUsername?: string;
  prefilledEmail?: string;
}

const signupSchema = z.object({
  fullName: z.string().min(3, "Full name must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type SignupValues = z.infer<typeof signupSchema>;

export default function SignupClient({
  redirectPath,
  staffToken,
  orgUsername,
  prefilledEmail,
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

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      email: normalizedPrefilledEmail,
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
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-100 mx-auto mb-12 py-0">
        <CardHeader className="space-y-1 px-6 pt-6 pb-0">
          <CardTitle className="text-2xl font-bold text-left">
            {isStaffInvite ? "Staff Invite" : "Create an account"}
          </CardTitle>
          <CardDescription className="text-left">
            {isStaffInvite
              ? `You've been invited to join as staff. Create your account to continue.`
              : redirectPath
                ? "Sign up to continue with your project signup"
                : "Enter your details below to create your account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
            >
              {isGoogleLoading ? (
                "Connecting..."
              ) : (
                <>
                  <svg
                    className="mr-2 h-4 w-4"
                    aria-hidden="true"
                    focusable="false"
                    data-prefix="fab"
                    data-icon="google"
                    role="img"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 488 512"
                  >
                    <path
                      fill="currentColor"
                      d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"
                    ></path>
                  </svg>
                  Continue with Google
                </>
              )}
            </Button>
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground font-medium">
                  Or continue with
                </span>
              </div>
            </div>
            <Controller
              control={form.control}
              name="fullName"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Full Name</FieldLabel>
                  <Input id={field.name} placeholder="John Doe" {...field} aria-invalid={fieldState.invalid} />
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
                  <Input id={field.name} placeholder="m@example.com" {...field} aria-invalid={fieldState.invalid} />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="password"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                  <Input id={field.name} type="password" {...field} aria-invalid={fieldState.invalid} />
                  {fieldState.invalid && <FormMessage errors={[fieldState.error]} />}
                  <div className="mt-3 space-y-2">
                    <div className="rounded-lg bg-warning/10 border border-warning/20 p-4 shadow-xs">
                      <p className="text-xs font-semibold text-warning mb-2.5 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        Password Requirements
                      </p>
                      <ul className="space-y-2 text-xs text-warning/90">
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
              <div className="relative w-75 h-16.25 overflow-hidden bg-muted/30 rounded-lg flex items-center justify-center border border-border/50">
                {!verification.isReady && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg bg-background/80 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Shield className="h-4 w-4 text-muted-foreground/80" />
                    <span className="text-[0.7rem] font-semibold normal-case">Bot verification loading…</span>
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
            <Button type="submit" className="w-full" disabled={isLoading || !verification.isReady}>
              {isLoading ? "Creating Account..." : "Create Account"}
            </Button>
            <div className="mt-2 text-center text-sm">
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
                className="underline"
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
    </div>
  );
}
