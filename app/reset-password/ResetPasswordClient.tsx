"use client";

import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { requestPasswordReset } from "./actions";
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
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TurnstileComponent, TurnstileRef } from "@/components/ui/turnstile";

const resetPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  turnstileToken: z.string().optional(),
});

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

interface ResetPasswordClientProps {
  error?: string;
}

export default function ResetPasswordClient({ error }: ResetPasswordClientProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [turnstileVerified, setTurnstileVerified] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      email: "",
      turnstileToken: "",
    },
  });

  async function onSubmit(data: ResetPasswordValues) {
    const turnstileToken = turnstileRef.current?.getResponse();
    
    setIsLoading(true);
    const formData = new FormData();
    formData.append("email", data.email);
    
    if (turnstileToken) {
      formData.append("turnstileToken", turnstileToken);
    }

    const result = await requestPasswordReset(formData);

    if (result.error) {
      if (result.error.email) {
        form.setError("email", {
          type: "server",
          message: result.error.email[0],
        });
      }
      if (result.error.server) {
        toast.error(result.error.server[0]);
      }
    } else {
      setEmailSent(true);
      form.reset();
    }

    setIsLoading(false);
    // Reset Turnstile after submission
    turnstileRef.current?.reset();
    setTurnstileVerified(false);
  }

  if (emailSent) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-sm mx-auto mb-12">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription>
              If an account exists with that email address, we&apos;ve sent password reset instructions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The email should arrive within a few minutes. Please check your spam folder if you don&apos;t see it.
            </p>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setEmailSent(false)}
              >
                Try another email
              </Button>
              <Link href="/login">
                  <Button variant="link" className="w-full">
                  Back to login
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-sm mx-auto mb-12">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Reset password</CardTitle>
          <CardDescription>
            Enter your email address and we&apos;ll send you a link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input 
                        type="email"
                        placeholder="m@example.com"
                        {...field}
                      />
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
                {isLoading ? "Sending Reset Link..." : "Send Reset Link"}
              </Button>
              <div className="text-center text-sm">
                Remember your password?{" "}
                <Link href="/login" className="underline">
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
