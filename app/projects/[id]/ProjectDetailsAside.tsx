"use client";

import Image from "next/image";
import Link from "next/link";
import {
  BadgeCheck,
  FileText,
  Lock,
  Mail,
  QrCode,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { NoAvatar } from "@/components/shared/NoAvatar";
import {
  OrganizationHoverCard,
  ProfileHoverCard,
} from "@/components/shared/ProfileHoverCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ProjectCreatorProfileRecord } from "@/lib/profile/public";
import type { Project } from "@/types";

function AsideHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-muted-foreground mb-2 text-sm font-medium">
      {children}
    </h3>
  );
}

function Requirement({
  icon: Icon,
  children,
}: {
  icon: typeof Lock;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      <Icon
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden="true"
      />
      {children}
    </li>
  );
}

/**
 * Supporting facts beside the schedule: who coordinates the project, how to
 * reach them, and what signing up involves. One card, divided sections.
 */
export function ProjectDetailsAside({
  project,
  creator,
  eagerImage,
  onPreviewImage,
}: {
  project: Project;
  creator: ProjectCreatorProfileRecord | null;
  eagerImage: boolean;
  onPreviewImage: (url: string, fileName: string, fileType: string) => void;
}) {
  const verification =
    project.verification_method === "qr-code"
      ? { icon: QrCode, label: "QR code check-in" }
      : project.verification_method === "manual"
        ? { icon: UserCheck, label: "Manual check-in" }
        : project.verification_method === "auto"
          ? { icon: Zap, label: "Automatic check-in" }
          : { icon: Users, label: "Sign-up only" };

  return (
    <Card className="gap-0 py-0">
      {project.cover_image_url && (
        <button
          type="button"
          className="focus-visible:ring-ring/50 block w-full cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
          aria-label="View project image"
          onClick={() =>
            onPreviewImage(
              project.cover_image_url!,
              project.title,
              "image/jpeg",
            )
          }
        >
          <Image
            src={project.cover_image_url}
            alt={project.title}
            width={300}
            height={180}
            loading={eagerImage ? "eager" : "lazy"}
            className="aspect-video h-auto w-full object-cover"
          />
        </button>
      )}

      <CardContent className="divide-y px-0 *:px-4 *:py-4">
        <section>
          <AsideHeading>Project coordinator</AsideHeading>
          <div className="grid gap-3">
            <ProfileHoverCard
              username={creator?.username || ""}
              fullName={creator?.full_name || "Anonymous"}
              avatarUrl={creator?.avatar_url || undefined}
              createdAt={creator?.created_at || undefined}
            >
              <Link
                href={`/profile/${creator?.username || ""}`}
                className="flex min-h-9 items-center gap-3"
              >
                <Avatar className="size-9">
                  {creator?.avatar_url ? (
                    <AvatarImage
                      src={creator.avatar_url}
                      alt={creator?.full_name || "Creator"}
                    />
                  ) : null}
                  <AvatarFallback className="bg-muted">
                    <NoAvatar
                      fullName={creator?.full_name}
                      className="text-sm font-medium"
                    />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {creator?.full_name || "Anonymous"}
                  </p>
                  <p className="text-muted-foreground truncate text-sm">
                    @{creator?.username || "user"}
                  </p>
                </div>
              </Link>
            </ProfileHoverCard>

            {project.organization && (
              <OrganizationHoverCard organization={project.organization}>
                <Link
                  href={`/organization/${project.organization.username}`}
                  className="flex min-h-9 items-center gap-3"
                >
                  <Avatar className="size-9">
                    {project.organization.logo_url ? (
                      <AvatarImage
                        src={project.organization.logo_url}
                        alt={project.organization.name}
                      />
                    ) : (
                      <AvatarFallback className="bg-muted text-xs">
                        {project.organization.name
                          .substring(0, 2)
                          .toUpperCase()}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium">
                        {project.organization.name}
                      </p>
                      {project.organization.verified && (
                        <BadgeCheck
                          className="text-success size-4 shrink-0"
                          aria-label="Verified organization"
                        />
                      )}
                    </div>
                    <p className="text-muted-foreground truncate text-sm">
                      @{project.organization.username}
                    </p>
                  </div>
                </Link>
              </OrganizationHoverCard>
            )}
          </div>
        </section>

        {creator?.email && (
          <section>
            <AsideHeading>Contact information</AsideHeading>
            <p className="mb-3 text-sm wrap-break-word">{creator.email}</p>
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = `mailto:${creator.email}?subject=Regarding project: ${project.title}`;
                toast.success("Opening email client");
              }}
            >
              <Mail data-icon="inline-start" aria-hidden="true" />
              Contact project coordinator
            </Button>
          </section>
        )}

        <section>
          <AsideHeading>Sign-up requirements</AsideHeading>
          <ul className="grid gap-2 text-sm">
            {project.require_login ? (
              <Requirement icon={Lock}>Account required</Requirement>
            ) : (
              <Requirement icon={Users}>Anonymous sign-ups allowed</Requirement>
            )}
            {project.waiver_required && (
              <Requirement icon={FileText}>Waiver required</Requirement>
            )}
            <Requirement icon={verification.icon}>
              {verification.label}
            </Requirement>
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
