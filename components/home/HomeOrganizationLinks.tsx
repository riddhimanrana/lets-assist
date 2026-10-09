import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Building2 } from "lucide-react";

import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import {
  isPluginHidden,
  loadPluginDisplayPreferences,
} from "@/lib/plugins/plugin-display-preferences";
import { resolveOrganizationPluginExperiences } from "@/lib/plugins/resolve-org-plugins";
import { createClient } from "@/lib/supabase/server";
import { getServerPreviewSource } from "@/lib/supabase/preview-source.server";
import { cn } from "@/lib/utils";

const CSF_PLUGIN_KEY = "dvhs-csf";

export async function HomeOrganizationLinks({ userId }: { userId: string }) {
  const previewSource = await getServerPreviewSource();
  if (previewSource === "remote") {
    return (
      <nav aria-label="Organizations">
        <Link
          href="/organization"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Open organizations
          <ArrowRight data-icon="inline-end" aria-hidden="true" />
        </Link>
      </nav>
    );
  }

  const supabase = await createClient();
  const preferences = await loadPluginDisplayPreferences(supabase, userId);
  if (
    !preferences.showPluginContent ||
    isPluginHidden(preferences, CSF_PLUGIN_KEY)
  ) {
    return null;
  }

  const { data, error } = await supabase
    .from("organization_members")
    .select(
      "organization_id, organization:organizations(id, name, username, logo_url)",
    )
    .eq("user_id", userId)
    .eq("status", "active");

  if (error || !data?.length) return null;

  const organizations = data.flatMap((row) => {
    const organization = Array.isArray(row.organization)
      ? row.organization[0]
      : row.organization;
    return organization ? [organization] : [];
  });
  if (!organizations.length) return null;

  const csfOrganizationIds = new Set(
    (
      await resolveOrganizationPluginExperiences(
        organizations.map(({ id }) => id),
      )
    )
      .filter(({ pluginKey }) => pluginKey === CSF_PLUGIN_KEY)
      .map(({ organizationId }) => organizationId),
  );
  const csfOrganizations = organizations.filter(({ id }) =>
    csfOrganizationIds.has(id),
  );
  if (!csfOrganizations.length) return null;

  return (
    <nav aria-label="Your organizations">
      <Card className="gap-0 divide-y py-0">
        {csfOrganizations.map((organization) => (
          <div
            key={organization.id}
            className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-3">
              {organization.logo_url ? (
                <Image
                  src={organization.logo_url}
                  alt=""
                  width={40}
                  height={40}
                  unoptimized
                  className="size-10 shrink-0 rounded-full border object-cover"
                />
              ) : (
                <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
                  <Building2
                    aria-hidden="true"
                    className="text-muted-foreground size-5"
                  />
                </div>
              )}
              <div className="grid min-w-0 gap-0.5">
                <h2 className="text-base font-semibold">{organization.name}</h2>
                <p className="text-muted-foreground text-sm">
                  Open your chapter&apos;s CSF activities and member tools.
                </p>
              </div>
            </div>
            <Link
              href={`/organization/${encodeURIComponent(organization.username || organization.id)}`}
              className={cn(
                buttonVariants({
                  variant: "outline",
                  className:
                    "h-auto min-h-9 max-w-full shrink-0 py-2 text-left whitespace-normal",
                }),
              )}
            >
              Open {organization.name}
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </div>
        ))}
      </Card>
    </nav>
  );
}
