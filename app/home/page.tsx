import React from "react";
import { Card } from "@/components/ui/card";
import { createClient } from "@/utils/supabase/server";
import { EmailVerificationToast } from "@/components/EmailVerificationToast";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus } from "lucide-react"; // Import the Plus icon
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/NoAvatar";
import { Metadata } from "next";
import { ProjectsInfiniteScroll } from "@/components/ProjectsInfiniteScroll";

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
          <Link href="/projects/create" className="w-full md:w-auto">
            <Button
              size="lg"
              className="font-semibold flex items-center gap-1 w-full md:w-auto"
            >
              <Plus className="w-4 h-4" /> {/* Add the Plus icon here */}
              Create Project
            </Button>
          </Link>
        </div>

        {/* Render the infinite scroll component */}
        <ProjectsInfiniteScroll />
      </main>
    </div>
  );
}
