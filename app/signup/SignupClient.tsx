"use client";

import { Shield } from "lucide-react";
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
  const [turnstileVerified, setTurnstileVerified] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
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

    if (result.error) {
      const errors = result.error;

      // Check if this is a confirmed email error
      if ('emailStatus' in result && result.emailStatus === 'confirmed') {
        toast.error("Account already exists", {
          description: "An account with this email address already exists and is verified. Please log in to access your account.",
          action: {
            label: "Go to Login",
            onClick: () => router.push("/login"),
          },
        });
        setIsLoading(false);
        turnstileRef.current?.reset();
        setTurnstileVerified(false);
        return;
      }

      // Check if this is an unconfirmed email error
      if ('emailStatus' in result && result.emailStatus === 'unconfirmed' && 'email' in result) {
        const unconfirmedEmail = result.email as string;
        toast.warning("Email not verified", {
          description: "An account with this email exists but hasn't been verified yet. We can resend the verification email.",
          action: {
            label: "Resend Email",
            onClick: async () => {
              const resendResult = await resendVerificationEmail(unconfirmedEmail);
              if (resendResult.success) {
                toast.success(resendResult.message || "Verification email sent!");
                router.push(`/signup/success?email=${encodeURIComponent(unconfirmedEmail)}`);
              } else {
                toast.error(resendResult.error || "Failed to resend email");
              }
            },
          },
        });
        setIsLoading(false);
        turnstileRef.current?.reset();
        setTurnstileVerified(false);
        return;
      }

      Object.keys(errors).forEach((key) => {
        if (key in errors && key in signupSchema.shape) {
          form.setError(key as keyof SignupValues, {
            type: "server",
            message: errors[key as keyof typeof errors]?.[0],
          });
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
    setTurnstileVerified(false);
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
    } catch (error) {
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
                  </FormItem>                  )}
                />
                <p className="text-sm text-muted-foreground text-center">
                  By joining, you agree to our{" "}
                  <Link href="/terms" className="text-chart-3">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link href="/privacy" className="text-chart-3">
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
                        setTurnstileVerified(true);
                        form.setValue("turnstileToken", token);
                      }}
                      onError={() => {
                        setTurnstileVerified(false);
                        toast.error("Security verification failed. Please try again.");
                      }}
                      onExpire={() => {
                        setTurnstileVerified(false);
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
    </div>
  );
}