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

  const { data: profile } = await supabase
    .from('profiles')
    .select('trusted_member')
    .eq('id', user.id)
    .single();

  if (!profile?.trusted_member) {
    const { data: tmApp } = await supabase
      .from('trusted_member')
      .select('status')
      .eq('id', user.id)
      .maybeSingle();
    const status = tmApp?.status ?? null;
    if (status === true) {
      // Permit access while profile flag syncs
    } else {
      return (
      <div className="container max-w-4xl py-6 px-4 mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Create Organization</h1>
          <p className="text-muted-foreground mt-1">
            Only Trusted Members can create organizations.
          </p>
        </div>
        <div className="rounded-md border p-4 space-y-2">
          {status === false ? (
            <p>
              It looks like you have already applied to be a Trusted Member and were not accepted. Please email support@lets-assist.com for further inquiries.
            </p>
          ) : (
            <p>
              Please fill out the Trusted Member form. Once accepted, you will have access to create organizations.
            </p>
          )}
          <a href="/trusted-member" className="text-primary underline">Go to Trusted Member form</a>
        </div>
      </div>
    );
    }
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
