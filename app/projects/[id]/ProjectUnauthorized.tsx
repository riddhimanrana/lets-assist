"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

import { NoticePage } from "@/components/projects/NoticePage";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface ProjectUnauthorizedProps {
  projectId: string;
}

export default function ProjectUnauthorized({
  projectId: _projectId,
}: ProjectUnauthorizedProps) {
  const router = useRouter();
  const { user, loading: isLoading } = useAuth(); // Use centralized auth hook
  const [isRedirecting, setIsRedirecting] = useState(false);
  const isLoggedIn = !!user;
  const needsLogin = !isLoading && !isLoggedIn;

  return (
    <NoticePage
      icon={<Lock aria-hidden="true" />}
      title="Private project"
      description={
        needsLogin
          ? "This project is private and requires organization access. You need to log in to access this private project."
          : "This project is private and requires organization access"
      }
      actions={
        <>
          {needsLogin && (
            <Button
              onClick={() => {
                setIsRedirecting(true);
                router.push("/login");
              }}
              disabled={isRedirecting}
            >
              {isRedirecting ? "Redirecting..." : "Log in to access"}
            </Button>
          )}
          <Link
            href="/organization/join"
            className={cn(
              buttonVariants({
                variant: needsLogin ? "outline" : "default",
              }),
            )}
          >
            Join organization
          </Link>
          <Link
            href="/projects"
            className={buttonVariants({ variant: "ghost" })}
          >
            Browse public projects
          </Link>
        </>
      }
    >
      <div className="grid gap-2 text-sm">
        <h2 className="font-medium">Access requirements</h2>
        <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5">
          <li>Be a member of the organization that owns this project</li>
          {!isLoggedIn && (
            <li>Log in with an account that has access to this organization</li>
          )}
          <li>Request access from the organization administrator if needed</li>
        </ol>
        <p className="text-muted-foreground mt-1">
          Private projects help organizations maintain confidentiality.
          Organization administrators can manage access in the project settings.
        </p>
      </div>
    </NoticePage>
  );
}
