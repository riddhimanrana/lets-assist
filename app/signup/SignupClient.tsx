"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signup, signInWithGoogle } from "./actions";
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
import { Toaster, toast } from "sonner";
import { useTheme } from "next-themes";
import { useSearchParams } from "next/navigation";

const signupSchema = z.object({
  fullName: z.string().min(3, "Full name must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type SignupValues = z.infer<typeof signupSchema>;

export default function SignupClient() {
  const { theme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const searchParams = useSearchParams();
  
  useEffect(() => {
    // Check for redirect in query params first
    const redirectParam = searchParams.get('redirect');
    if (redirectParam) {
      setRedirectUrl(redirectParam);
      // Store in sessionStorage for after authentication
      sessionStorage.setItem('redirect_after_auth', redirectParam);
    } else {
      // Check if there's a redirect URL in sessionStorage
      const storedRedirect = sessionStorage.getItem('redirect_after_auth');
      if (storedRedirect) {
        setRedirectUrl(storedRedirect);
      }
    }
  }, [searchParams]);
  
  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
    },
  });
  
  async function onSubmit(data: SignupValues) {
    setIsLoading(true);
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => formData.append(key, value));
    
    // Pass redirect URL if available
    if (redirectUrl) {
      formData.append('redirectUrl', redirectUrl);
    }
    
    const result = await signup(formData);
    
    if (result.error) {
      const errors: {
        email?: string[];
        password?: string[];
        server?: string[];
      } = result.error;
      
      Object.keys(errors).forEach((key) => {
        if (key in errors && key in signupSchema.shape) {
          form.setError(key as keyof SignupValues, {
            type: "server",
            message: errors[key as keyof typeof errors]?.[0],
          });
        }
      });
      
      if (errors.server && errors.server[0] === "ACCEXISTS0") {
        console.log(errors);
        toast.warning("This email is already registered. Please sign in.");
      } else if (errors.server && errors.server[0] === "NOCNFRM0") {
        toast.warning(
          "Email confirmation is required. Please check your inbox.",
        );
      } else {
        toast.error(
          "Sorry, there was an error creating your account. Please try again.",
        );
      }
    } else if (result.success) {
      form.reset();
      toast.success("Please check your email for a confirmation link.", {
        duration: 15000, // duration in milliseconds (15 seconds)
      });
    }
    
    setIsLoading(false);
  }
  
  const handleGoogleSignIn = async () => {
    try {
      setIsGoogleLoading(true);
      // Pass the redirect URL to Google sign-in if available
      const result = await signInWithGoogle(redirectUrl);
      
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
            Create an account
          </CardTitle>
          <CardDescription className="text-left">
            {redirectUrl 
              ? "Sign up to continue with your project signup" 
              : "Enter your details below to create your account"
            }
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
                  </FormItem>
                )}
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
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Creating Account..." : "Create Account"}
              </Button>
              <div className="mt-4 text-center text-sm">
                Already have an account?{" "}
                <Link 
                  href={redirectUrl ? `/login?redirect=${encodeURIComponent(redirectUrl)}` : "/login"}
                  className="underline"
                >
                  Sign in
                </Link>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
      <Toaster
        position="bottom-right"
        theme={theme as "light" | "dark"}
        richColors
      />
    </div>
  );
}