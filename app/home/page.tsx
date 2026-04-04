import React from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { redirect } from "next/navigation";
import { EmailVerificationToast } from "@/components/auth/EmailVerificationToast";
import { EmailConfirmationModal } from "@/components/auth/EmailConfirmationModal";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, Shield } from "lucide-react"; // Import the Plus and Shield icons
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { Metadata } from "next";
import { ProjectsInfiniteScroll } from "@/components/projects/ProjectsInfiniteScroll";
import { checkSuperAdmin } from "@/app/admin/actions";

export const metadata: Metadata = {
  title: "Home",
  description:
    "Find and join local volunteer projects. Connect with your community and make a difference today.",
};

export default async function Home() {
  const supabase = await createClient();

  // Get the current user using getClaims() for better performance
  const { user, error: userError } = await getAuthUser();
  if (userError || !user) {
    redirect("/login?redirect=/home");
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("full_name, avatar_url, username")
    .eq("id", user.id)
    .single();
  const userName = profileData?.full_name || "Anonymous";

  // Check if user is super admin
  const { isAdmin } = await checkSuperAdmin();
  
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
            {isAdmin && (
              <Link href="/admin" className="w-full md:w-auto">
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
            )}
            <Link href="/projects/create" className="w-full md:w-auto pointer-events-auto">
              <Button
                size="lg"
                className="font-semibold flex items-center gap-1 w-full md:w-auto"
              >
                <Plus className="w-4 h-4" />
                Create Project
              </Button>
            </Link>
          </div>
        </div>

        {/* Render the infinite scroll component */}
        <ProjectsInfiniteScroll />
      </main>
    </div>
  );
}
