import { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import SignupGeniusImporter from "./SignupGeniusImporter";

interface OrganizationOption {
  id: string;
  name: string;
  logo_url?: string | null;
  role: string;
  allowed_email_domains?: string[] | null;
}

interface OrganizationMembership {
  organization_id: string;
  role: string;
  organizations:
    | {
        id: string;
        name: string;
        logo_url?: string | null;
        allowed_email_domains?: string[] | null;
      }
    | Array<{
        id: string;
        name: string;
        logo_url?: string | null;
        allowed_email_domains?: string[] | null;
      }>
    | null;
}

export const metadata: Metadata = {
  title: "Import from SignUpGenius",
  description:
    "Convert SignUpGenius signups into Let’s Assist projects with schedule previews and guided import.",
};

export default async function SignupGeniusImportPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/login?redirect=/projects/import/signupgenius");
  }

  const { data: userProfile } = await supabase
    .from("profiles")
    .select("profile_image_url, trusted_member")
    .eq("id", user.id)
    .single();

  if (!userProfile?.trusted_member) {
    const { data: tmApp } = await supabase
      .from("trusted_member")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    const status = tmApp?.status ?? null;

    if (status !== true) {
      return (
        <div className="container mx-auto p-6 max-w-2xl">
          <h1 className="text-2xl font-bold mb-2">Import SignUpGenius</h1>
          <p className="text-muted-foreground mb-6">
            Only Trusted Members can import SignUpGenius projects.
          </p>
          <div className="rounded-md border p-4 space-y-2">
            {status === false ? (
              <p>
                It looks like you applied to be a Trusted Member but were not
                accepted. If you believe this is an error, please contact
                support@lets-assist.com.
              </p>
            ) : (
              <p>
                To request access, please complete the Trusted Member form. Once
                accepted, you can import SignUpGenius signups.
              </p>
            )}
            <a href="/trusted-member" className="text-primary underline">
              Go to Trusted Member form
            </a>
          </div>
        </div>
      );
    }
  }

  let orgOptions: OrganizationOption[] = [
    {
      id: "personal",
      name: "Personal Project",
      logo_url: userProfile?.profile_image_url || null,
      role: "creator",
    },
  ];

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(id, name, logo_url, allowed_email_domains)")
    .eq("user_id", user.id)
    .in("role", ["admin", "staff"]);

  if (memberships && memberships.length > 0) {
    const orgs: OrganizationOption[] = (memberships as OrganizationMembership[]).map((m) => ({
      id: m.organization_id,
      name: Array.isArray(m.organizations)
        ? m.organizations[0].name
        : m.organizations?.name,
      logo_url: Array.isArray(m.organizations)
        ? m.organizations[0].logo_url
        : m.organizations?.logo_url,
      allowed_email_domains: Array.isArray(m.organizations)
        ? m.organizations[0].allowed_email_domains
        : m.organizations?.allowed_email_domains,
      role: m.role,
    }));
    orgOptions = [orgOptions[0], ...orgs];
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <SignupGeniusImporter orgOptions={orgOptions} />
    </div>
  );
}
