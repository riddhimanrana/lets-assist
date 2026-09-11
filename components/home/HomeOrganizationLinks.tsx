import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Building2 } from "lucide-react";

import { buttonVariants } from "@/components/ui/button-variants";
import { createClient } from "@/lib/supabase/server";
import { getServerPreviewSource } from "@/lib/supabase/preview-source.server";

export async function HomeOrganizationLinks({ userId }: { userId: string }) {
  const previewSource = await getServerPreviewSource();
  if (previewSource === "remote") {
    return (
      <nav aria-label="Organizations" className="mb-6">
        <Link href="/organization" className={buttonVariants({ size: "lg" })}>
          Open organizations
          <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
        </Link>
      </nav>
    );
  }

  const supabase = await createClient();
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

  return (
    <nav aria-label="Your organizations" className="mb-6 grid gap-3">
      {organizations.map((organization) => (
        <div
          key={organization.id}
          className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
        >
          <div className="flex min-w-0 items-center gap-3">
            {organization.logo_url ? (
              <Image
                src={organization.logo_url}
                alt=""
                width={48}
                height={48}
                unoptimized
                className="size-12 shrink-0 rounded-full border object-cover"
              />
            ) : (
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted">
                <Building2
                  aria-hidden="true"
                  className="size-6 text-muted-foreground"
                />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{organization.name}</h2>
              <p className="text-sm text-muted-foreground">
                Open your organization for its activities and member tools.
                Browse Let&apos;s Assist volunteer projects below.
              </p>
            </div>
          </div>
          <Link
            href={`/organization/${encodeURIComponent(organization.username || organization.id)}`}
            className={buttonVariants({
              className:
                "h-auto max-w-full shrink-0 whitespace-normal py-2 text-left",
            })}
          >
            Open {organization.name}
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </Link>
        </div>
      ))}
    </nav>
  );
}
