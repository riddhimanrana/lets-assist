import React from "react";
import { Card } from "@/components/ui/card";
import { createClient } from "@/utils/supabase/server";
import { EmailVerificationToast } from "@/components/EmailVerificationToast";
import { EmailConfirmationModal } from "@/components/EmailConfirmationModal";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, Shield } from "lucide-react"; // Import the Plus and Shield icons
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/NoAvatar";
import { Metadata } from "next";
import { ProjectsInfiniteScroll } from "@/components/ProjectsInfiniteScroll";
import { TrustedInfoIcon } from "@/components/TrustedInfoIcon";
import { checkSuperAdmin } from "@/app/admin/actions";

export const metadata: Metadata = {
  title: "Home",
  description:
    "Find and join local volunteer projects. Connect with your community and make a difference today.",
};

export default async function Home() {
  const supabase = await createClient();
  
  // Get the current user and profile
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profileData } = await supabase
    .from("profiles")
    .select("full_name, avatar_url, username, trusted_member")
    .eq("id", user?.id)
    .single();
  const userName = profileData?.full_name || "Anonymous";
  let isTrusted = !!profileData?.trusted_member;

  // Check if user is super admin
  const { isAdmin } = await checkSuperAdmin();

  // Determine application status (NULL: pending, TRUE: accepted, FALSE: denied)
  let applicationStatus: boolean | null | undefined = undefined;
  if (user) {
    const { data: tmApp } = await supabase
      .from("trusted_member")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    applicationStatus = tmApp?.status ?? null; // if no row -> null (treated as pending until they submit)
    // Consider accepted application as trusted even if profile flag hasn't synced yet
    if (!isTrusted && tmApp?.status === true) {
      isTrusted = true;
    }
  }
  
  return (
    <div className="min-h-screen">
      <EmailConfirmationModal />
      <EmailVerificationToast />
      <main className="mx-auto px-4 sm:px-8 lg:px-12 py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div className="flex items-center gap-3" data-tour-id="home-greeting">
            <Avatar className="w-10 h-10">
              <AvatarImage src={profileData?.avatar_url} alt={userName} />
              <AvatarFallback>
                <NoAvatar fullName={profileData?.full_name} />
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-3xl font-bold">Hi, {userName}</h1>
              <p className="text-sm text-muted-foreground">
                Check out the latest projects
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto" data-tour-id="home-create-project">
            {/* {isAdmin && (
              <Link href="/admin/moderation" className="w-full md:w-auto">
                <Button
                  size="lg"
                  variant="outline"
                  className="font-semibold flex items-center gap-2 w-full md:w-auto border-primary/20 hover:bg-primary/5"
                >
                  <Shield className="w-4 h-4 text-primary" />
                  <span className="hidden sm:inline">Admin Dashboard</span>
                  <span className="sm:hidden">Admin</span>
                </Button>
              </Link>
            )} */}
            <Link href={isTrusted ? "/projects/create" : "#"} className="w-full md:w-auto pointer-events-auto">
              <Button
                size="lg"
                className="font-semibold flex items-center gap-1 w-full md:w-auto"
                disabled={!isTrusted}
              >
                <Plus className="w-4 h-4" />
                Create Project
              </Button>
            </Link>
            {!isTrusted && (
              <TrustedInfoIcon
                message={
                  applicationStatus === false
                    ? "It looks like you've already applied to be a Trusted Member. Please email support@lets-assist.com for further assistance."
                    : "You must be a Trusted Member to create projects. Apply using the form."
                }
              />
            )}
          </div>
        </div>

        {/* Render the infinite scroll component */}
        <ProjectsInfiniteScroll />
      </main>
    </div>
  );
}
