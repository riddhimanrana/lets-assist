import { ReadLoadError } from "@/components/projects/ReadLoadError";
import { safeConsole } from "@/lib/safe-console";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { InviteShell } from "./InviteCard";
import JoinSignInCard from "./JoinSignInCard";
import { Metadata } from "next";
import JoinLoader from "./JoinLoader";

export const metadata: Metadata = {
  title: "Join Organization",
  description: "Join an organization on Let's Assist",
};

interface Props {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}

type JoinOrganization = {
  id: string;
  name: string;
  username: string;
  logo_url: string | null;
};

export default async function JoinOrganizationPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const search = await searchParams;
  const code = search.code;
  if (!code) {
    redirect("/organization");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Find organization by join code
  const admin = getAdminClient();
  const { data: organization, error: lookupError } = (await admin
    .from("organizations")
    .select("id, name, username, logo_url")
    .eq("join_code", code)
    .maybeSingle()) as {
    data: JoinOrganization | null;
    error: { message: string; code?: string } | null;
  };

  // A failed lookup says nothing about the code, so it is not reported as an
  // invalid code and nothing joins. Retrying reruns this read from the URL.
  // Only the error class is logged: the message can repeat the request.
  if (lookupError) {
    safeConsole.error("Error looking up organization join code.", {
      code: lookupError.code,
    });
    return (
      <InviteShell>
        <div className="w-full max-w-sm">
          <ReadLoadError title="We couldn't check this join link" />
        </div>
      </InviteShell>
    );
  }

  if (!organization) {
    redirect("/organization?error=invalid-code");
  }

  return (
    <InviteShell>
      {user ? (
        // Signed in: join automatically, showing which organization it is.
        <JoinLoader
          organizationId={organization.id}
          code={code}
          userId={user.id}
          organization={organization}
        />
      ) : (
        // Signed out: ask to sign in or sign up first.
        <JoinSignInCard organization={organization} joinCode={code} />
      )}
    </InviteShell>
  );
}
