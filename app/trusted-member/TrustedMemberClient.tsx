"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { CheckCircle2, Clock, XCircle, Shield } from "lucide-react";
import { TrustedMemberApplication } from "@/types";
import { createClient } from "@/utils/supabase/client";

const trustedMemberSchema = z.object({
  name: z.string()
    .min(1, "Full name is required")
    .max(50, "Full name cannot exceed 50 characters"),
  email: z.string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .max(100, "Email cannot exceed 100 characters"),
  reason: z.string()
    .min(10, "Please provide at least 10 characters explaining your reason")
    .max(500, "Reason cannot exceed 500 characters"),
});

type TrustedMemberFormValues = z.infer<typeof trustedMemberSchema>;

interface TrustedMemberClientProps {
  user: any;
  userProfile: any;
  existingApplication: TrustedMemberApplication | null;
}

export default function TrustedMemberClient({ 
  user, 
  userProfile, 
  existingApplication 
}: TrustedMemberClientProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<TrustedMemberFormValues>({
    resolver: zodResolver(trustedMemberSchema),
    defaultValues: {
      name: userProfile?.full_name || "",
      email: userProfile?.email || "",
      reason: "",
    },
  });

  // If user is already a trusted member, show success message
  if (userProfile?.trusted_member === true) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <Shield className="w-8 h-8 text-green-600" />
          </div>
          <CardTitle className="text-2xl text-green-600">You&apos;re All Set!</CardTitle>
          <CardDescription>
            You are already a trusted member of Let&apos;s Assist
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-center gap-2 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">Trusted Member Status: Active</span>
            </div>
            <p className="text-green-600 text-sm mt-2">
              You can now create projects and organizations on Let&apos;s Assist.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // If user has an existing application, show status
  if (existingApplication) {
    const getStatusInfo = () => {
      if (existingApplication.status === null) {
        return {
          icon: <Clock className="w-5 h-5" />,
          text: "Application Pending",
          description: "Your application is under review. We'll notify you once it's been processed.",
          color: "text-amber-600",
          bgColor: "bg-amber-50",
          borderColor: "border-amber-200",
        };
      } else if (existingApplication.status === true) {
        return {
          icon: <CheckCircle2 className="w-5 h-5" />,
          text: "Application Accepted",
          description: "Congratulations! Your application has been approved. Your trusted member status will be activated shortly.",
          color: "text-green-600",
          bgColor: "bg-green-50",
          borderColor: "border-green-200",
        };
      } else {
        return {
          icon: <XCircle className="w-5 h-5" />,
          text: "Application Denied",
          description: "Unfortunately, your application was not approved at this time. You may reapply after 30 days.",
          color: "text-red-600",
          bgColor: "bg-red-50",
          borderColor: "border-red-200",
        };
      }
    };

    const statusInfo = getStatusInfo();

    return (
      <Card>
        <CardHeader>
          <CardTitle>Trusted Member Application Status</CardTitle>
          <CardDescription>
            Track the progress of your trusted member application
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className={`${statusInfo.bgColor} ${statusInfo.borderColor} border rounded-lg p-4`}>
            <div className={`flex items-center gap-2 ${statusInfo.color} mb-2`}>
              {statusInfo.icon}
              <span className="font-medium">{statusInfo.text}</span>
            </div>
            <p className={`text-sm ${statusInfo.color}`}>
              {statusInfo.description}
            </p>
            <div className="mt-3 text-xs text-muted-foreground">
              Applied on: {new Date(existingApplication.created_at).toLocaleDateString()}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show application form
  const onSubmit = async (values: TrustedMemberFormValues) => {
    setIsSubmitting(true);
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from('trusted_member')
        .insert({
          name: values.name,
          email: values.email,
          reason: values.reason,
          status: null, // null means pending
        });

      if (error) {
        throw error;
      }

      toast.success("Application submitted successfully!");
      
      // Refresh the page to show the status
      window.location.reload();
    } catch (error) {
      console.error('Error submitting application:', error);
      toast.error("Failed to submit application. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Trusted Member Application</h1>
        <p className="text-muted-foreground mt-2">
          Apply to become a trusted member and unlock the ability to create projects and organizations
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Application Form</CardTitle>
          <CardDescription>
            Please fill out the form below to apply for trusted member status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Your full name" {...field} />
                    </FormControl>
                    <FormDescription>
                      Your legal full name (max 50 characters)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="your.email@example.com" {...field} />
                    </FormControl>
                    <FormDescription>
                      Email address where we can contact you (max 100 characters)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason for Application</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Please explain why you want to become a trusted member and how you plan to use this status..."
                        rows={6}
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>
                      Explain your motivation and plans (max 500 characters)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Submitting..." : "Submit Application"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}