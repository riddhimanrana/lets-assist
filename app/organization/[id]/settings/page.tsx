import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { Separator } from "@/components/ui/separator";
import EditOrganizationForm from "./EditOrganizationForm";
import { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent 
} from "@/components/ui/card";
import JoinCodeAdminDisplay from "./JoinCodeAdminDisplay";
import StaffLinkDisplay from "./StaffLinkDisplay";
import DeleteOrganizationDialog from "./DeleteOrganizationDialog";


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
    ? await supabase
      .from("organizations")
      .select("name")
      .eq("id", id)
      .single()
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
  
  // Check if user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=/organization/${id}/edit`);
  }

  // Check if ID is a username or UUID
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  
  // Try to fetch organization by username or ID depending on the format
  const { data: organization } = isUUID
    ? await supabase
        .from("organizations")
        .select("*, organization_members!inner(user_id, role)")
        .eq("id", id)
        .single()
    : await supabase
        .from("organizations")
        .select("*, organization_members!inner(user_id, role)")
        .eq("username", id)
        .single();
  
  if (!organization) {
    notFound();
  }

  // Check if user is an admin
  const isAdmin = organization.organization_members.some(
    (member: { user_id: string; role: string }) => member.user_id === user.id && member.role === 'admin'
  );

  // If not admin, redirect to organization page
  if (!isAdmin) {
    redirect(`/organization/${id}`);
  }

  return (
    <div className="flex justify-center w-full">
      <div className="container max-w-4xl py-4 sm:py-8 px-4 sm:px-6">
        <div className="mb-2">
          <Button 
            variant="ghost" 
            size="sm" 
            asChild
            className="mb-4"
          >
            <Link href={`/organization/${organization.username}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Organization
            </Link>
          </Button>
          
          <h1 className="text-3xl font-bold tracking-tight">Organization Settings</h1>
          <p className="text-muted-foreground mt-1">
            Manage settings and details for {organization.name}
          </p>
        </div>
        
        <Separator className="my-6" />
        
        <div className="space-y-8">
          {/* Basic Details Section */}
          <EditOrganizationForm 
            organization={organization} 
            _userId={user.id} 
          />
          
          {/* Join Code Management */}
          <Card>
            <CardHeader>
              <CardTitle>Join Code Management</CardTitle>
              <CardDescription>
                Manage your organization&apos;s join code to invite members
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                Use this code to invite new members to your organization. You can regenerate the code at any time.
              </p>
              <JoinCodeAdminDisplay
                organizationId={organization.id}
                joinCode={organization.join_code}
              />
            </CardContent>
          </Card>
          
          {/* Staff Invite Link */}
          <Card>
            <CardHeader>
              <CardTitle>Staff Invite Link</CardTitle>
              <CardDescription>
                Generate a special link for teachers and staff to join with elevated permissions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StaffLinkDisplay
                organizationId={organization.id}
                organizationUsername={organization.username}
              />
            </CardContent>
          </Card>
          
          {/* Member Data Management */}
          {/* <Card>
            <CardHeader>
              <CardTitle>Member Data</CardTitle>
              <CardDescription>
                Export your organization&apos;s member list
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                Download your organization&apos;s member data for record-keeping or offline management.
              </p>
              <MemberExporter organizationId={organization.id} />
            </CardContent>
          </Card> */}
          
          {/* Danger Zone */}
          <Card className="border-destructive/50">
            <CardHeader className="border-b border-destructive/10">
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
              <CardDescription>
                Irreversible and destructive actions
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-medium text-base">Delete Organization</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Permanently delete this organization and all associated data
                    </p>
                  </div>
                  <DeleteOrganizationDialog organization={organization} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
