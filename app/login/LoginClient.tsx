"use client";
import { useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { login, signInWithGoogle } from "./actions";
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
import { EmailVerifiedModal } from "@/components/EmailVerifiedModal";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  turnstileToken: z.string().optional(),
});

type LoginValues = z.infer<typeof loginSchema>;

interface LoginClientProps {
  redirectPath?: string;
}

export default function LoginClient({ redirectPath }: LoginClientProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [turnstileVerified, setTurnstileVerified] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      turnstileToken: "",
    },
  });

  const searchParams = useSearchParams();
  const isVerified = searchParams.get('verified') === 'true';

  async function onSubmit(data: LoginValues) {
    const turnstileToken = turnstileRef.current?.getResponse();
    
    setIsLoading(true);
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => formData.append(key, value));
    
    if (turnstileToken) {
      formData.append("turnstileToken", turnstileToken);
    }
    
    const result = await login(formData);

    if (result.error) {
      const errors = result.error;
      Object.keys(errors).forEach((key) => {
        if (key in errors && key in loginSchema.shape) {
          form.setError(key as keyof LoginValues, {
            type: "server",
            message: errors[key as keyof typeof errors]?.[0],
          });
        }
      });

      if ("server" in errors && errors.server?.[0]?.includes("captcha verification process failed")) {
        toast.error("Security verification failed. Please complete the captcha again.");
        turnstileRef.current?.reset();
        setTurnstileVerified(false);
      } else if ("server" in errors && errors.server?.[0]?.includes("provider")) {
        toast.error(
          "This email is registered with password. Please sign in with email and password.",
        );
      } else {
        toast.error("Incorrect email or password.");
      }
    } else if (result.success) {
      if (isVerified) {
        window.location.href = "/home?confirmed=true";
      } else {
        window.location.href = redirectPath ? decodeURIComponent(redirectPath) : "/home";
      }
    }

    setIsLoading(false);
    // Reset Turnstile after submission
    turnstileRef.current?.reset();
    setTurnstileVerified(false);
  }

  const handleGoogleSignIn = async () => {
    try {
      setIsGoogleLoading(true);

      const result = await signInWithGoogle(redirectPath ? decodeURIComponent(redirectPath) : null);

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
    <div className="flex items-center justify-center min-h-screen">
      <EmailVerifiedModal />
      <Card className="mx-auto w-[370px] max-w-full mb-12">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription className="w-full">
        {redirectPath 
          ? "Login to continue to the requested page"
          : "Enter your email below to login to your account"
        }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <Button
                type="button"
                variant="outline"
                className="w-full mb-2"
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
                    Login with Google
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
              <div className="grid gap-4">
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
                      <div className="flex items-center">
                        <FormLabel>Password</FormLabel>
                        <Link
                          href="/reset-password"
                          className="ml-auto inline-block text-sm underline"
                        >
                          Forgot your password?
                        </Link>
                      </div>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-center">
                  <div className="w-[300px] h-[65px] overflow-hidden bg-muted/30 rounded-lg flex items-center justify-center border border-border/50">
                    <TurnstileComponent
                      ref={turnstileRef}
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
                  {isLoading ? "Logging in..." : "Login"}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                Don&apos;t have an account?{" "}
                <Link 
                  href={redirectPath ? `/signup?redirect=${redirectPath}` : "/signup"} 
                  className="underline"
                >
                  Sign up
                </Link>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
