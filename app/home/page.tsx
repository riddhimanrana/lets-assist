import { safeConsole } from "@/lib/safe-console";
import React, { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { redirect } from "next/navigation";
import { EmailVerificationToast } from "@/components/auth/EmailVerificationToast";
import { EmailConfirmationModal } from "@/components/auth/EmailConfirmationModal";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { Metadata } from "next";
import { ProjectsInfiniteScroll } from "@/components/projects/ProjectsInfiniteScroll";
import { PluginFeedSection } from "@/components/plugins/PluginFeedSection";
import { HomeOrganizationLinks } from "@/components/home/HomeOrganizationLinks";
import { checkSuperAdmin } from "@/app/admin/actions";
import { withRetryableSupabaseQuery } from "@/lib/supabase/retry-query";
import { HomeHeaderActions } from "./HomeHeaderActions";

export const metadata: Metadata = {
  title: "Home",
  description:
    "Find and join local volunteer projects. Connect with your community and make a difference today.",
};

interface HomePageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function Home({ searchParams }: HomePageProps) {
  const { next } = await searchParams;
  const supabase = await createClient();

  // Get the current user using getClaims() for better performance
  const { user, error: userError } = await getAuthUser();
  if (userError || !user) {
    redirect("/login?redirect=/home");
  }

  const profileResult = await withRetryableSupabaseQuery(() =>
    supabase
      .from("profiles")
      .select("full_name, avatar_url, username")
      .eq("id", user.id)
      .maybeSingle(),
  );

  const { data: profileData, error: profileError } = profileResult as {
    data: {
      full_name: string | null;
      avatar_url: string | null;
      username: string | null;
    } | null;
    error: { message?: string } | null;
  };

  if (profileError) {
    safeConsole.warn("[Home] Failed to load profile data:", profileError);
  }
  const authMetadata = user.user_metadata as
    Record<string, unknown> | null | undefined;
  const userName =
    profileData?.full_name ||
    (typeof authMetadata?.full_name === "string"
      ? authMetadata.full_name
      : null) ||
    (typeof authMetadata?.name === "string" ? authMetadata.name : null) ||
    (typeof authMetadata?.display_name === "string"
      ? authMetadata.display_name
      : null) ||
    user.email?.split("@")[0] ||
    "Let's Assist user";

  // Check if user is super admin
  const { isAdmin } = await checkSuperAdmin();

  return (
    <div className="min-h-screen">
      <EmailConfirmationModal />
      <EmailVerificationToast />
      <main
        className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6"
        data-next-url={next}
      >
        <PageHeader
          media={
            <Avatar className="size-10">
              <AvatarImage
                src={profileData?.avatar_url ?? undefined}
                alt={userName}
              />
              <AvatarFallback>
                <NoAvatar fullName={profileData?.full_name ?? userName} />
              </AvatarFallback>
            </Avatar>
          }
          title={<span data-tour-id="home-greeting">Hi, {userName}</span>}
          description="Check out the latest projects"
          actions={<HomeHeaderActions isAdmin={isAdmin} />}
        />

        <Suspense fallback={null}>
          <HomeOrganizationLinks userId={user.id} />
        </Suspense>

        <Suspense fallback={null}>
          <PluginFeedSection userId={user.id} />
        </Suspense>

        {/* Render the infinite scroll component */}
        <ProjectsInfiniteScroll />
      </main>
    </div>
  );
}
