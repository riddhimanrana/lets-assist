import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import OrganizationCreator from "./OrganizationCreator";

export const metadata: Metadata = {
  title: "Create Organization",
  description: "Set up a new organization on Let's Assist",
};

const createBreadcrumb = (
  <Breadcrumb>
    <BreadcrumbList>
      <BreadcrumbItem>
        <BreadcrumbLink render={<Link href="/organization" />}>
          Organizations
        </BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbItem>
        <BreadcrumbPage>Create</BreadcrumbPage>
      </BreadcrumbItem>
    </BreadcrumbList>
  </Breadcrumb>
);

export default async function CreateOrganizationPage() {
  const supabase = await createClient();

  // Use getUser instead of getSession for security
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?redirect=/organization/create");
  }

  const { data: isTrustedMember } = await supabase.rpc("is_trusted_member", {
    p_user: user.id,
  });

  if (isTrustedMember !== true) {
    const { data: tmApp } = await supabase
      .from("trusted_member")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    const status = tmApp?.status ?? null;
    if (status === true) {
      // Permit access while profile flag syncs
    } else {
      return (
        <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8 sm:px-6">
          <PageHeader
            breadcrumb={createBreadcrumb}
            title="Create organization"
            description="Only Trusted Members can create organizations."
          />
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldCheck />
              </EmptyMedia>
              <EmptyTitle>Trusted Member access required</EmptyTitle>
              <EmptyDescription>
                {status === false
                  ? "It looks like you have already applied to be a Trusted Member and were not accepted. Please email support@lets-assist.com for further inquiries."
                  : "Please fill out the Trusted Member form. Once accepted, you will have access to create organizations."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href="/trusted-member">Go to Trusted Member form</Link>
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      );
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8 sm:px-6">
      <PageHeader
        breadcrumb={createBreadcrumb}
        title="Create organization"
        description="Set up the public profile for your organization. You can invite members once it exists."
      />

      <OrganizationCreator userId={user.id} />
    </div>
  );
}
