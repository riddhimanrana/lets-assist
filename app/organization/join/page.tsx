import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import AuthDialog from "./AuthDialog";
import { Metadata } from "next";
import JoinLoader from "./JoinLoader";

export const metadata: Metadata = {
  title: "Join Organization",
  description: "Join an organization on Let's Assist",
};

interface Props {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}

export default async function JoinOrganizationPage({ searchParams }: Props): Promise<React.ReactElement> {
  const search = await searchParams;
  const code = search.code;
  if (!code) {
    redirect("/organization");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Find organization by join code
  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name, username, logo_url")
    .eq("join_code", code)
    .single();

  if (!organization) {
    redirect("/organization?error=invalid-code");
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      {user ? (
        // If user is logged in, show auto-join loader
        <JoinLoader 
          organizationId={organization.id}
          code={code}
          userId={user.id}
        />
      ) : (
        // If user is not logged in, show auth dialog
        <AuthDialog 
          organization={organization}
          joinCode={code}
        />
      )}
    </div>
  );
}
