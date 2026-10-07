import React from "react";
import { Metadata } from "next";
import { ProjectsInfiniteScroll } from "@/components/projects/ProjectsInfiniteScroll";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
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
    <div className="min-h-screen">
      <main className="mx-auto px-4 sm:px-8 lg:px-12 py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold">Volunteer Projects</h1>
            <p className="text-sm text-muted-foreground">
              Browse available volunteer opportunities
            </p>
          </div>
          <div className="flex gap-3 items-center text-muted-foreground text-sm">
            <Link
              href="/login"
              className={buttonVariants({ variant: "outline" })}
            >
              Log in
            </Link>
            or
            <Link href="/signup" className={buttonVariants()}>
              Sign Up
            </Link>
            <span className="text-sm text-muted-foreground">
              to create projects
            </span>
          </div>
        </div>
        {/* Render the infinite scroll component */}
        <ProjectsInfiniteScroll />
      </main>
    </div>
  );
}
