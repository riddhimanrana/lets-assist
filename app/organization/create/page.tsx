import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { Separator } from "@/components/ui/separator";
import OrganizationCreator from "./OrganizationCreator";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Organization",
  description: "Set up your organization and invite members",
};

export default async function CreateOrganizationPage() {
  const supabase = await createClient();
  
  // Use getUser instead of getSession for security
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?redirect=/organization/create");
  }

  // Check if user is a trusted member
  const { data: userProfile } = await supabase
    .from('profiles')
    .select('trusted_member')
    .eq('id', user.id)
    .single();

  if (!userProfile?.trusted_member) {
    return (
      <div className="container mx-auto px-4 sm:px-8 lg:px-12 py-8 max-w-2xl text-center space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-4">Trusted Member Required</h1>
          <p className="text-lg text-muted-foreground mb-6">
            Only trusted members can create projects and organizations on Let&apos;s Assist.
          </p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <div className="text-blue-600">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-left">
              <h3 className="font-medium text-blue-900 mb-2">How to become a trusted member</h3>
              <p className="text-sm text-blue-800 mb-4">
                Trusted members are verified users who help maintain the quality and safety of volunteer opportunities on our platform.
              </p>
              <a 
                href="/trusted-member"
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                Apply for Trusted Member Status
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6 px-4 mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Create Organization</h1>
        <p className="text-muted-foreground mt-1">
          Set up your organization and invite members
        </p>
      </div>
      
      <Separator className="mb-6" />
      
      <OrganizationCreator userId={user.id} />
    </div>
  );
}
