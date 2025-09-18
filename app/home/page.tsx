import React from "react";
import { Card } from "@/components/ui/card";
import { createClient } from "@/utils/supabase/server";
import { EmailVerificationToast } from "@/components/EmailVerificationToast";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, HelpCircle } from "lucide-react"; // Import the Plus and HelpCircle icons
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/NoAvatar";
import { Metadata } from "next";
import { ProjectsInfiniteScroll } from "@/components/ProjectsInfiniteScroll";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  
  return (
    <div className="min-h-screen">
      <EmailVerificationToast />
      <main className="mx-auto px-4 sm:px-8 lg:px-12 py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div className="flex items-center gap-3">
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
          {profileData?.trusted_member ? (
            <Link href="/projects/create" className="w-full md:w-auto">
              <Button
                size="lg"
                className="font-semibold flex items-center gap-1 w-full md:w-auto"
              >
                <Plus className="w-4 h-4" />
                Create Project
              </Button>
            </Link>
          ) : (
            <TooltipProvider>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <Button
                  size="lg"
                  disabled
                  className="font-semibold flex items-center gap-1 w-full md:w-auto opacity-60"
                >
                  <Plus className="w-4 h-4" />
                  Create Project
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="p-1 h-8 w-8"
                    >
                      <HelpCircle className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Apply to become a trusted member to create projects</p>
                    <Link href="/trusted-member" className="text-xs underline">
                      Fill out the trusted member form
                    </Link>
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          )}
        </div>

        {/* Render the infinite scroll component */}
        <ProjectsInfiniteScroll />
      </main>
    </div>
  );
}
