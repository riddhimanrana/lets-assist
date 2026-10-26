import React from "react";
import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { ProjectsInfiniteScroll } from "@/components/projects/ProjectsInfiniteScroll";
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
    <div className="mx-auto min-h-screen w-full max-w-screen-2xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Upcoming volunteer projects"
        description="Find an open project, choose a shift, and sign up. Organizers can start a project of their own."
        className="mb-6"
      />
      <div className="mb-8 flex flex-wrap gap-3">
        <Link href="/signup" className={buttonVariants({ size: "lg" })}>
          Sign up to volunteer{" "}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
        <Link
          href="/signup?redirect=%2Fprojects%2Fcreate"
          className={buttonVariants({ size: "lg", variant: "outline" })}
        >
          <Plus aria-hidden="true" className="size-4" /> Create a project
        </Link>
      </div>
      <nav
        aria-label="Ways to get started"
        className="mb-8 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3"
      >
        <Link
          href="#open-projects"
          className="bg-background p-4 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        >
          <span className="block text-sm font-semibold">Find a shift</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            Choose an open public project below.
          </span>
        </Link>
        <Link
          href="/organization"
          className="bg-background p-4 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        >
          <span className="block text-sm font-semibold">Explore groups</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            See organization profiles and their projects.
          </span>
        </Link>
        <Link
          href="/signup?redirect=%2Fprojects%2Fcreate"
          className="bg-background p-4 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        >
          <span className="block text-sm font-semibold">Create your own</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            Set up a project and share its link.
          </span>
        </Link>
      </nav>
      <div id="open-projects" className="mb-4 scroll-mt-24">
        <h2 className="text-xl font-semibold tracking-tight">
          Open public projects
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          If this list is quiet, an organizer may still have an unlisted or
          organization-only project to share with you. Ask for their direct link
          or explore organizations.
        </p>
      </div>
      <ProjectsInfiniteScroll />
    </div>
  );
}
