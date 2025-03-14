import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { Separator } from "@/components/ui/separator";
import OrganizationCreator from "./OrganizationCreator";

export default async function CreateOrganizationPage() {
  const supabase = await createClient();
  
  // Use getUser instead of getSession for security
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?redirect=/organization/create");
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
