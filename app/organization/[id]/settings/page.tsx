import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import EditOrganizationForm from "./EditOrganizationForm";
import JoinCodeAdminDisplay from "./JoinCodeAdminDisplay";
import StaffLinkDisplay from "./StaffLinkDisplay";
import DeleteOrganizationDialog from "./DeleteOrganizationDialog";
import OrganizationCalendarSettings from "./OrganizationCalendarSettings";
import BulkImportSection from "./BulkImportSection";
import OrganizationSheetsSettings from "./OrganizationSheetsSettings";
import OrganizationPluginSettings from "./OrganizationPluginSettings";
import OrganizationSettingsShell from "./OrganizationSettingsShell";
import OrganizationVerificationSection from "./OrganizationVerificationSection";
import MemberExporter from "./MemberExporter";
import { hasActiveOrganizationAdminMembership } from "@/lib/organization/active-membership";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();

  // Try to fetch by username first
  const { data: orgByUsername } = await supabase
    .from("organizations")
    .select("name")
    .eq("username", id)
    .single();

  // If not found by username, try by ID
  const { data: orgById } = !orgByUsername
    ? await supabase.from("organizations").select("name").eq("id", id).single()
    : { data: null };

  const org = orgByUsername || orgById;

  if (!org) {
    return {
      title: "Organization Settings",
      description: "Manage organization settings and details",
    };
  }

  return {
    title: `${org.name} Settings`,
    description: `Manage ${org.name} organization settings and details`,
  };
}

export default async function OrganizationSettingsPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  // Check if user is authenticated using getClaims() for better performance
  const { user } = await getAuthUser();
  if (!user) {
    const returnPath = `/organization/${encodeURIComponent(id)}/settings`;
    redirect(`/login?redirect=${encodeURIComponent(returnPath)}`);
  }

  // Check if ID is a username or UUID
  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  // Resolve only public-safe fields first, then prove admin membership before
  // loading capability fields such as join/staff tokens with the server client.
  const { data: organizationIdentity } = isUUID
    ? await supabase
        .from("organizations")
        .select("id, username, name")
        .eq("id", id)
        .single()
    : await supabase
        .from("organizations")
        .select("id, username, name")
        .eq("username", id)
        .single();

  if (!organizationIdentity) {
    notFound();
  }

  const admin = getAdminClient();
  const isActiveAdmin = await hasActiveOrganizationAdminMembership(
    admin,
    organizationIdentity.id,
    user.id,
  );

  // If not admin, redirect to organization page
  if (!isActiveAdmin) {
    redirect(`/organization/${id}`);
  }

  const { data: organization } = await admin
    .from("organizations")
    .select("*")
    .eq("id", organizationIdentity.id)
    .single();

  if (!organization) {
    notFound();
  }

  const organizationPath = `/organization/${organization.username}`;
  const organizationSlug = organization.username || organization.id;
  const autoJoinDomain = organization.auto_join_domain as
    string | null | undefined;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href={organizationPath} />}>
                  {organization.name}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Settings</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="Settings"
        description={`Manage how ${organization.name} is set up on Let's Assist.`}
      />

      <OrganizationSettingsShell
        sections={{
          general: (
            <>
              <EditOrganizationForm
                organization={organization}
                userId={user.id}
                section="general"
              />
              <OrganizationVerificationSection
                verified={organization.verified === true}
              />
            </>
          ),
          members: (
            <>
              <EditOrganizationForm
                organization={organization}
                userId={user.id}
                section="members"
              />
              <SettingsSection
                title="Automatic domain membership"
                description="People who sign in with an email on your verified domain join automatically."
                status={
                  autoJoinDomain ? (
                    <Badge variant="success">Enabled</Badge>
                  ) : (
                    <Badge variant="outline">Not set up</Badge>
                  )
                }
                footerHint={
                  autoJoinDomain
                    ? "Contact Let's Assist support to change or disable it."
                    : "Contact Let's Assist support after organization verification to enable one."
                }
              >
                {autoJoinDomain ? (
                  <p className="text-sm">
                    Verified domain:{" "}
                    <span className="font-mono">{autoJoinDomain}</span>
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No verified domain is configured.
                  </p>
                )}
              </SettingsSection>
              <MemberExporter organizationId={organization.id} />
            </>
          ),
          invitations: (
            <>
              <JoinCodeAdminDisplay
                organizationId={organization.id}
                joinCode={organization.join_code}
              />
              <StaffLinkDisplay
                organizationId={organization.id}
                organizationUsername={organization.username}
              />
              <BulkImportSection organizationId={organization.id} />
            </>
          ),
          integrations: (
            <>
              <OrganizationCalendarSettings
                organizationId={organization.id}
                organizationSlug={organizationSlug}
                organizationName={organization.name}
              />
              <OrganizationSheetsSettings
                organizationId={organization.id}
                organizationSlug={organizationSlug}
                organizationName={organization.name}
              />
            </>
          ),
          plugins: (
            <OrganizationPluginSettings
              organizationId={organization.id}
              organizationName={organization.name}
            />
          ),
          danger: (
            <SettingsSection
              tone="danger"
              title="Delete organization"
              description="Permanently delete this organization and all associated data. This cannot be undone."
              footerHint="You will be asked to confirm by typing the organization username."
              footer={<DeleteOrganizationDialog organization={organization} />}
            />
          ),
        }}
      />
    </div>
  );
}
