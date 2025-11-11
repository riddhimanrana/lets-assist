"use client";

import { useEffect, useState, useTransition } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { createClient } from "@/utils/supabase/client";
import { CheckCircle2, Clock, XCircle, ShieldCheck } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription as FieldDescription,
} from "@/components/ui/form";
import { submitTrustedMember } from "@/app/trusted-member/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const MAX = {
  name: 50,
  email: 100,
  reason: 500,
} as const;

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Please enter your full name (min 2 characters)")
    .max(MAX.name, `Max ${MAX.name} characters`),
  email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .max(MAX.email, `Max ${MAX.email} characters`),
  reason: z
    .string()
    .trim()
    .min(10, "Please share a brief reason (min 10 characters)")
    .max(MAX.reason, `Max ${MAX.reason} characters`),
});

type FormValues = z.infer<typeof schema>;

type AppStatus = "none" | "pending" | "accepted" | "rejected";

export function SubmitTrustedMemberForm({
  defaultName = "",
  defaultEmail = "",
}: {
  defaultName?: string;
  defaultEmail?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [appStatus, setAppStatus] = useState<AppStatus>("none");
  const [checkingStatus, setCheckingStatus] = useState<boolean>(true);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: defaultName,
      email: defaultEmail,
      reason: "",
    },
    mode: "onChange",
  });

  const nameVal = form.watch("name");
  const emailVal = form.watch("email");
  const reasonVal = form.watch("reason");

  // On mount, check if the user already has an application and its status
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (mounted) setAppStatus("none");
          return;
        }
        // First, check if profile is already trusted
        const { data: profile } = await supabase
          .from("profiles")
          .select("trusted_member")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.trusted_member) {
          if (mounted) setAppStatus("accepted");
          return;
        }
        // Then, check the trusted_member application
        const { data: appRow } = await supabase
          .from("trusted_member")
          .select("status")
          .eq("id", user.id)
          .maybeSingle();
        const statusVal = appRow?.status;
        const status: AppStatus =
          statusVal === true
            ? "accepted"
            : statusVal === false
              ? "rejected"
              : appRow
                ? "pending"
                : "none";
        if (mounted) setAppStatus(status);
      } finally {
        if (mounted) setCheckingStatus(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  function onSubmit(values: FormValues) {
    setServerError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await submitTrustedMember(values);
      if (res?.error) {
        setServerError(res.error);
        return;
      }
      setSuccess("Application submitted! We’ll email you when it’s reviewed.");
      // Switch view to Pending status after successful submission
      setAppStatus("pending");
      // Optionally reset reason field only
      // form.reset({ ...values, reason: "" });
    });
  }

  // If we detect an existing application or accepted status, render a status view instead of the form
  if (!checkingStatus && appStatus !== "none") {
    const StatusIcon =
      appStatus === "accepted"
        ? ShieldCheck
        : appStatus === "rejected"
          ? XCircle
          : Clock; // pending
    const title =
      appStatus === "accepted"
        ? "You’re a Trusted Member"
        : appStatus === "rejected"
          ? "Application not approved"
          : "Application pending review";
    const description =
      appStatus === "accepted"
        ? "You now have access to create projects and organizations."
        : appStatus === "rejected"
          ? "If you have questions, please email support@lets-assist.com."
          : "Thanks for applying! We’ll email you once your application is reviewed.";

    return (
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <StatusIcon className={
              appStatus === "accepted"
                ? "h-5 w-5 text-chart-5"
                : appStatus === "rejected"
                  ? "h-5 w-5 text-destructive"
                  : "h-5 w-5 text-muted-foreground"
            } />
            <CardTitle className="text-xl">{title}</CardTitle>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle className="text-xl">Apply to be a Trusted Member</CardTitle>
        </div>
        <CardDescription>
          We review applications to keep the platform safe. Please use your real
          name and a brief description of why you need Trusted access.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Full name</FormLabel>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {nameVal?.length ?? 0}/{MAX.name}
                    </span>
                  </div>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={MAX.name}
                      placeholder="Your full name"
                      className="w-full"
                    />
                  </FormControl>
                  <FieldDescription>As it appears on official ID.</FieldDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Email</FormLabel>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {emailVal?.length ?? 0}/{MAX.email}
                    </span>
                  </div>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      inputMode="email"
                      maxLength={MAX.email}
                      placeholder="you@example.com"
                      className="w-full"
                    />
                  </FormControl>
                  <FieldDescription>We’ll only use this to contact you about your application.</FieldDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Reason</FormLabel>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {reasonVal?.length ?? 0}/{MAX.reason}
                    </span>
                  </div>
                  <FormControl>
                    <Textarea
                      {...field}
                      maxLength={MAX.reason}
                      rows={5}
                      placeholder="Tell us briefly why you need Trusted Member access"
                      className="w-full"
                    />
                  </FormControl>
                  <FieldDescription>Minimum 10 characters. Helpful details: what you’re building, expected usage, timelines.</FieldDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {serverError ? (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Submission failed</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            ) : null}
            {success ? (
              <Alert variant="success">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Success</AlertTitle>
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            ) : null}

            <Separator />
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Button type="submit" className="w-full sm:w-auto" disabled={pending || !form.formState.isValid}>
                {pending ? "Submitting..." : "Submit Application"}
              </Button>
              {!form.formState.isValid && (
                <span className="text-xs text-muted-foreground">Please fix the errors above to submit.</span>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
