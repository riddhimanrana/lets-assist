"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trustedMemberSchema, type TrustedMemberValues, type TrustedMemberApplication } from "@/schemas/trusted-member-schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Clock, User } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";

interface TrustedMemberClientProps {
  user: User;
  profile: {
    trusted_member?: boolean | null;
    full_name?: string | null;
    email?: string | null;
  } | null;
  existingApplication: TrustedMemberApplication | null;
}

export default function TrustedMemberClient({ 
  user, 
  profile, 
  existingApplication 
}: TrustedMemberClientProps) {
  const [isLoading, setIsLoading] = useState(false);
  const supabase = createClient();

  const form = useForm<TrustedMemberValues>({
    resolver: zodResolver(trustedMemberSchema),
    defaultValues: {
      fullName: profile?.full_name || "",
      email: user.email || profile?.email || "",
      reason: "",
    },
  });

  async function onSubmit(data: TrustedMemberValues) {
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from("trusted_member")
        .insert({
          name: data.fullName,
          email: data.email,
          reason: data.reason,
        });

      if (error) {
        console.error("Error submitting application:", error);
        toast.error("Failed to submit application. Please try again.");
        return;
      }

      toast.success("Application submitted successfully!");
      // Refresh the page to show the new status
      window.location.reload();
    } catch (error) {
      console.error("Error submitting application:", error);
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  // If user is already a trusted member
  if (profile?.trusted_member === true) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle className="text-2xl">You're All Set!</CardTitle>
          <CardDescription>
            You're a trusted member of Let's Assist
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Badge variant="default" className="mb-4">
            <User className="w-4 h-4 mr-2" />
            Trusted Member
          </Badge>
          <p className="text-muted-foreground mb-6">
            You can now create projects and organizations on Let's Assist. 
            Your volunteer hours will be automatically verified.
          </p>
          <Button asChild>
            <a href="/projects/create">Create Project</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // If user has an existing application
  if (existingApplication) {
    const getStatusInfo = () => {
      if (existingApplication.status === null) {
        return {
          icon: <Clock className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />,
          title: "Application Pending",
          description: "We're reviewing your application",
          badge: <Badge variant="secondary"><Clock className="w-4 h-4 mr-2" />Pending</Badge>,
          bgColor: "bg-yellow-100 dark:bg-yellow-900/20"
        };
      } else if (existingApplication.status === true) {
        return {
          icon: <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />,
          title: "Application Accepted",
          description: "Congratulations! Your application has been approved",
          badge: <Badge variant="default"><CheckCircle className="w-4 h-4 mr-2" />Accepted</Badge>,
          bgColor: "bg-green-100 dark:bg-green-900/20"
        };
      } else {
        return {
          icon: <XCircle className="w-8 h-8 text-red-600 dark:text-red-400" />,
          title: "Application Denied",
          description: "Your application was not approved at this time",
          badge: <Badge variant="destructive"><XCircle className="w-4 h-4 mr-2" />Denied</Badge>,
          bgColor: "bg-red-100 dark:bg-red-900/20"
        };
      }
    };

    const statusInfo = getStatusInfo();

    return (
      <Card>
        <CardHeader className="text-center">
          <div className={`mx-auto w-16 h-16 ${statusInfo.bgColor} rounded-full flex items-center justify-center mb-4`}>
            {statusInfo.icon}
          </div>
          <CardTitle className="text-2xl">{statusInfo.title}</CardTitle>
          <CardDescription>{statusInfo.description}</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          {statusInfo.badge}
          <div className="mt-6 p-4 bg-muted rounded-lg">
            <h4 className="font-semibold mb-2">Application Details</h4>
            <div className="text-sm text-muted-foreground space-y-1">
              <p><strong>Name:</strong> {existingApplication.name}</p>
              <p><strong>Email:</strong> {existingApplication.email}</p>
              <p><strong>Submitted:</strong> {new Date(existingApplication.created_at).toLocaleDateString()}</p>
            </div>
          </div>
          {existingApplication.status === false && (
            <p className="text-sm text-muted-foreground mt-4">
              You may submit a new application in the future. Please ensure you meet all requirements.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Show application form
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Trusted Member Application</CardTitle>
        <CardDescription>
          Apply to become a trusted member and unlock the ability to create projects and organizations on Let's Assist.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name *</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      placeholder="Enter your full name"
                      maxLength={50}
                    />
                  </FormControl>
                  <div className="text-xs text-muted-foreground">
                    {field.value?.length || 0}/50 characters
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address *</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      type="email"
                      placeholder="Enter your email address"
                      maxLength={100}
                    />
                  </FormControl>
                  <div className="text-xs text-muted-foreground">
                    {field.value?.length || 0}/100 characters
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Why do you want to become a trusted member? *</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      placeholder="Please explain why you want to become a trusted member and how you plan to use this privilege..."
                      maxLength={500}
                      rows={5}
                    />
                  </FormControl>
                  <div className="text-xs text-muted-foreground">
                    {field.value?.length || 0}/500 characters
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="bg-muted p-4 rounded-lg">
              <h4 className="font-semibold mb-2">What being a trusted member means:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Create and manage volunteer projects</li>
                <li>• Create and manage organizations</li>
                <li>• Your volunteer hours will be automatically verified</li>
                <li>• Display a verified badge on your profile</li>
              </ul>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Submitting..." : "Submit Application"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}