import Link from "next/link";
import { ArrowRight } from "lucide-react";

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
    .select("organization_id, organization:organizations(id, name, username)")
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
    <nav aria-label="Your organizations" className="mb-6 flex flex-wrap gap-3">
      {organizations.map((organization) => (
        <Link
          key={organization.id}
          href={`/organization/${encodeURIComponent(organization.username || organization.id)}`}
          className={buttonVariants({
            size: "lg",
            className: "h-auto max-w-full whitespace-normal py-3 text-left",
          })}
        >
          Open {organization.name}
          <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
        </Link>
      ))}
    </nav>
  );
}
