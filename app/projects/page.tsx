import React from "react";
import { Metadata } from "next";

import { PageHeader } from "@/components/layout/PageHeader";
import { ProjectsInfiniteScroll } from "@/components/projects/ProjectsInfiniteScroll";
import { getAuthUser } from "@/lib/supabase/auth-helpers";

import UserProjects from "./UserProjects";

async function getUserData() {
  return getAuthUser();
}

export async function generateMetadata(): Promise<Metadata> {
  const { user } = await getUserData();
  if (user) {
    return {
      title: "My Projects",
      description: "Manage and view your volunteer projects.",
    };
  } else {
    return {
      title: "Volunteer Projects",
      description:
        "Browse volunteer opportunities in your area. Connect with your community and make a difference today.",
    };
  }
}

export default async function ProjectsPage() {
  const { user } = await getUserData();
  if (user) {
    return <UserProjects />;
  }
  // Default content for non-authenticated users
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Volunteer projects"
        description="Browse available volunteer opportunities. Sign up to join one or to run your own."
        className="mb-6"
      />
      <ProjectsInfiniteScroll />
    </main>
  );
}
