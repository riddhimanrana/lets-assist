"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trustedMemberSchema, type TrustedMemberFormData } from "@/schemas/trusted-member-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Clock, XCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { submitTrustedMemberApplication } from "./actions";
import Link from "next/link";

interface TrustedMemberFormProps {
  profile: {
    full_name: string | null;
    email: string | null;
    trusted_member: boolean | null;
  } | null;
  application: {
    id: string;
    name: string;
    email: string;
    reason: string;
    status: boolean | null;
    created_at: string;
  } | null;
  userEmail: string;
}

export default function TrustedMemberForm({ profile, application, userEmail }: TrustedMemberFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<TrustedMemberFormData>({
    resolver: zodResolver(trustedMemberSchema),
    defaultValues: {
      name: profile?.full_name || "",
      email: profile?.email || userEmail,
      reason: "",
    },
  });

  // If user is already a trusted member
  if (profile?.trusted_member === true) {
    return (
      <div className="text-center space-y-6">
        <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
        <div>
          <h1 className="text-3xl font-bold mb-2">You&apos;re All Good!</h1>
          <p className="text-lg text-muted-foreground">
            You&apos;re already a trusted member and can create projects and organizations.
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/create">Create Project</Link>
        </Button>
      </div>
    );
  }

  // Show application status if exists
  if (application) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">Trusted Member Application</h1>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">Your Application Status</CardTitle>
              {application.status === null && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Pending
                </Badge>
              )}
              {application.status === true && (
                <Badge variant="default" className="flex items-center gap-1 bg-green-600">
                  <CheckCircle className="h-3 w-3" />
                  Accepted
                </Badge>
              )}
              {application.status === false && (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  Denied
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-medium text-sm text-muted-foreground">Submitted on</h4>
              <p>{new Date(application.created_at).toLocaleDateString()}</p>
            </div>
            <div>
              <h4 className="font-medium text-sm text-muted-foreground">Name</h4>
              <p>{application.name}</p>
            </div>
            <div>
              <h4 className="font-medium text-sm text-muted-foreground">Email</h4>
              <p>{application.email}</p>
            </div>
            <div>
              <h4 className="font-medium text-sm text-muted-foreground">Reason</h4>
              <p className="text-sm">{application.reason}</p>
            </div>
            
            {application.status === null && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium">Application Under Review</p>
                    <p>Your application is being reviewed by our team. We&apos;ll update your status soon.</p>
                  </div>
                </div>
              </div>
            )}

            {application.status === true && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                  <div className="text-sm text-green-800">
                    <p className="font-medium">Congratulations!</p>
                    <p>Your trusted member application has been approved. You can now create projects and organizations.</p>
                  </div>
                </div>
              </div>
            )}

            {application.status === false && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-red-600 mt-0.5" />
                  <div className="text-sm text-red-800">
                    <p className="font-medium">Application Denied</p>
                    <p>Unfortunately, your application was not approved at this time. You can submit a new application if your circumstances have changed.</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {(application.status === false || application.status === true) && (
          <div className="text-center">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Submit New Application
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Show application form
  const onSubmit = async (data: TrustedMemberFormData) => {
    setIsSubmitting(true);
    try {
      await submitTrustedMemberApplication(data);
      toast.success("Application submitted successfully!");
      window.location.reload();
    } catch (error) {
      toast.error("Failed to submit application. Please try again.");
      console.error("Application submission error:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">Become a Trusted Member</h1>
        <p className="text-lg text-muted-foreground">
          Apply to create projects and organizations on Let&apos;s Assist
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trusted Member Application</CardTitle>
          <CardDescription>
            Trusted members can create volunteer projects and organizations. Please fill out the form below with accurate information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <Input
                id="name"
                {...form.register("name")}
                placeholder="Enter your full name"
                maxLength={50}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-600 mt-1">{form.formState.errors.name.message}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {form.watch("name")?.length || 0}/50 characters
              </p>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Contact Email <span className="text-red-500">*</span>
              </label>
              <Input
                id="email"
                type="email"
                {...form.register("email")}
                placeholder="Enter your email address"
                maxLength={100}
              />
              {form.formState.errors.email && (
                <p className="text-sm text-red-600 mt-1">{form.formState.errors.email.message}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {form.watch("email")?.length || 0}/100 characters
              </p>
            </div>

            <div>
              <label htmlFor="reason" className="block text-sm font-medium mb-1">
                Reason for Application <span className="text-red-500">*</span>
              </label>
              <Textarea
                id="reason"
                {...form.register("reason")}
                placeholder="Please explain why you want to become a trusted member and how you plan to use this privilege..."
                rows={6}
                maxLength={500}
              />
              {form.formState.errors.reason && (
                <p className="text-sm text-red-600 mt-1">{form.formState.errors.reason.message}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {form.watch("reason")?.length || 0}/500 characters
              </p>
            </div>

            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Submitting..." : "Submit Application"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium">What is a Trusted Member?</p>
            <p>Trusted members are verified users who can create volunteer projects and organizations on Let&apos;s Assist. This helps ensure the quality and safety of opportunities on our platform.</p>
          </div>
        </div>
      </div>
    </div>
  );
}