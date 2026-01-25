"use client";

import { Shield, AlertCircle, CheckCircle2 } from "lucide-react";
import { useState, useRef } from "react";
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
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { TurnstileComponent, TurnstileRef } from "@/components/ui/turnstile";
import { useRouter } from "next/navigation";

interface SignupClientProps {
  redirectPath?: string;
  staffToken?: string;
  orgUsername?: string;
}

const signupSchema = z.object({
  fullName: z.string().min(3, "Full name must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  turnstileToken: z.string().optional(),
});

type SignupValues = z.infer<typeof signupSchema>;

export default function SignupClient({ redirectPath, staffToken, orgUsername }: SignupClientProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [isResendCaptchaOpen, setIsResendCaptchaOpen] = useState(false);
  const [unconfirmedEmailForResend, setUnconfirmedEmailForResend] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [resendTurnstileToken, setResendTurnstileToken] = useState<string | null>(null);
  const [resendTurnstileReady, setResendTurnstileReady] = useState(false);
  const resendTurnstileRef = useRef<TurnstileRef>(null);
  const isTurnstileBypassed = process.env.NEXT_PUBLIC_TURNSTILE_BYPASS === "true";

  const router = useRouter();

  // Check if this is a staff invite signup
  const isStaffInvite = !!(staffToken && orgUsername);

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      turnstileToken: "",
    },
  });

  const handleResendWithCaptcha = async () => {
    if (!unconfirmedEmailForResend || (!resendTurnstileToken && !isTurnstileBypassed)) {
      toast.error("Please complete the verification challenge.");
      return;
    }

    setIsResending(true);
    try {
      const resendToken = resendTurnstileToken ?? (isTurnstileBypassed ? "turnstile-bypass" : undefined);
      const resendResult = await resendVerificationEmail(unconfirmedEmailForResend, resendToken);
      if (resendResult.success) {
        toast.success(resendResult.message || "Verification email sent!");
        router.push(`/signup/success?email=${encodeURIComponent(unconfirmedEmailForResend)}`);
        setIsResendCaptchaOpen(false);
      } else {
        toast.error(resendResult.error || "Failed to resend email");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsResending(false);
      resendTurnstileRef.current?.reset();
      setResendTurnstileToken(null);
    }
  };

  async function onSubmit(data: SignupValues) {
    const turnstileToken = turnstileRef.current?.getResponse();

    setIsLoading(true);
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => formData.append(key, value));
    if (redirectPath) {
      formData.append("redirectUrl", redirectPath);
    }

    if (turnstileToken) {
      formData.append("turnstileToken", turnstileToken);
    }

    // Add staff token if present
    if (staffToken) {
      formData.append("staffToken", staffToken);
    }
    if (orgUsername) {
      formData.append("orgUsername", orgUsername);
    }

    const result = await signup(formData);
    console.log("[Signup] Result:", result);

    if (result.error) {
      const errors = result.error;
      console.warn("[Signup] Error encountered:", errors);

      // Check if this is a confirmed email error
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
        turnstileRef.current?.reset();
        return;
      }

      // Check if this is an unconfirmed email error
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
        turnstileRef.current?.reset();
        return;
      }

      Object.keys(errors).forEach((key) => {
        if (key in signupSchema.shape) {
          form.setError(key as keyof SignupValues, {
            type: "server",
            message: errors[key as keyof typeof errors]?.[0],
          });
        } else if (key !== "server") {
          // Fallback for fields not in the client-side schema (like staffToken/orgUsername)
          toast.error(`Error: ${errors[key as keyof typeof errors]?.[0]}`);
        }
      });

      if ("server" in errors && errors.server) {
        toast.error(errors.server[0]);
      }
    } else if (result.success && result.email) {
      // Redirect to success page
      router.push(`/signup/success?email=${encodeURIComponent(result.email)}`);
      return;
    }

    setIsLoading(false);
    // Reset Turnstile after submission
    turnstileRef.current?.reset();
  }

  const handleGoogleSignIn = async () => {
    try {
      setIsGoogleLoading(true);
      const result = await signInWithGoogle(redirectPath ?? null);

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
      <Card className="w-full max-w-sm mx-auto mb-12">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-left">
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
        <CardContent>
          <Form {...form}>
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
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    Or continue with
                  </span>
                </div>
              </div>
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="m@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                    <div className="mt-3 space-y-2">
                      <div className="rounded-lg bg-[hsl(var(--warning)/0.15)] border border-[hsl(var(--warning)/0.4)] p-3 shadow-xs">
                        <p className="text-xs font-semibold text-[hsl(var(--warning))] dark:text-[hsl(var(--warning))] mb-2 flex items-center gap-2">
                          <AlertCircle className="h-3.5 w-3.5" />
                          Password Requirements
                        </p>
                        <ul className="space-y-1.5 text-xs text-[hsl(var(--warning))] dark:text-[hsl(var(--warning))] opacity-90">
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
                  </FormItem>
                )}
              />
              <p className="text-sm text-muted-foreground text-center">
                By joining, you agree to our{" "}
                <Link href="/terms" className="text-primary hover:underline">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="text-primary hover:underline">
                  Privacy Policy
                </Link>
              </p>
              <div className="flex justify-center">
                <div className="relative w-[300px] h-[65px] overflow-hidden bg-muted/30 rounded-lg flex items-center justify-center border border-border/50">
                  {!turnstileReady && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg bg-background/80 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Shield className="h-4 w-4 text-muted-foreground/80" />
                      <span className="text-[0.7rem] font-semibold normal-case tracking-wide">Bot verification loading…</span>
                    </div>
                  )}
                  <TurnstileComponent
                    ref={turnstileRef}
                    onLoad={() => setTurnstileReady(true)}
                    onVerify={(token) => {
                      form.setValue("turnstileToken", token);
                    }}
                    onError={() => {
                      toast.error("Security verification failed. Please try again.");
                    }}
                    onExpire={() => {
                      form.setValue("turnstileToken", "");
                    }}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Creating Account..." : "Create Account"}
              </Button>
              <div className="mt-4 text-center text-sm">
                Already have an account?{" "}
                <Link
                  href={redirectPath ? `/login?redirect=${encodeURIComponent(redirectPath)}` : "/login"}
                  className="underline"
                >
                  Sign in
                </Link>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Dialog open={isResendCaptchaOpen} onOpenChange={setIsResendCaptchaOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Verify before resending</DialogTitle>
            <DialogDescription>
              Complete the verification challenge so we can safely send a fresh confirmation link to your email.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-4">
            <div className="relative w-[300px] h-[65px] overflow-hidden rounded-lg bg-muted/30 border border-border/50 flex items-center justify-center">
              {!resendTurnstileReady && !isTurnstileBypassed && (
                <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg bg-background/80 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground text-center px-4">
                  <Shield className="h-4 w-4 text-muted-foreground/80 shrink-0" />
                  <span>Bot verification loading…</span>
                </div>
              )}
              <TurnstileComponent
                ref={resendTurnstileRef}
                onLoad={() => setResendTurnstileReady(true)}
                onVerify={(token) => setResendTurnstileToken(token)}
                onError={() => {
                  setResendTurnstileToken(null);
                  toast.error("Verification failed. Please try again.");
                }}
                onExpire={() => setResendTurnstileToken(null)}
              />
            </div>
          </div>
          <DialogFooter className="flex flex-col gap-2">
            <Button
              onClick={handleResendWithCaptcha}
              disabled={(!resendTurnstileToken && !isTurnstileBypassed) || isResending}
              className="w-full"
            >
              {isResending ? "Sending…" : "Verify & Send"}
            </Button>
            <Button variant="ghost" onClick={() => setIsResendCaptchaOpen(false)} className="w-full">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}