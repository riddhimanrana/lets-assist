"use client";

import Link from "next/link";
import { Shield } from "lucide-react";

import { PlusIcon, useAnimatedIcon } from "@/components/icons/animated";
import { Button } from "@/components/ui/button";

/**
 * The home header's actions: "Create project" is the one primary, and site
 * admins also get a quiet link to the admin dashboard.
 */
export function HomeHeaderActions({ isAdmin }: { isAdmin: boolean }) {
  const createIcon = useAnimatedIcon();

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-tour-id="home-create-project"
    >
      {isAdmin && (
        <Button asChild variant="outline">
          <Link href="/admin">
            <Shield data-icon="inline-start" aria-hidden="true" />
            <span className="hidden sm:inline">Admin dashboard</span>
            <span className="sm:hidden">Admin</span>
          </Link>
        </Button>
      )}
      <Button asChild {...createIcon.triggerProps}>
        <Link href="/projects/create">
          <PlusIcon
            ref={createIcon.ref}
            size={16}
            data-icon="inline-start"
            aria-hidden="true"
          />
          Create project
        </Link>
      </Button>
    </div>
  );
}
