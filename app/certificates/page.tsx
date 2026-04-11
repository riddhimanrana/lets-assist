import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { CertificatesList } from "./CertificatesList";
import { Metadata } from "next";
import { withRetryableSupabaseQuery } from "@/lib/supabase/retry-query";

type Certificate = {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  event_start: string;
  event_end: string;
  volunteer_email: string | null;
  organization_name: string | null;
  project_id: string | null;
  schedule_id: string | null;
  issued_at: string;
  signup_id: string | null;
  volunteer_name: string | null;
  project_location: string | null;
  projects?: {
    project_timezone?: string;
  };
};

export const metadata: Metadata = {
  title: "Certificates",
  description: "View and manage your earned volunteer certificates.",
};


export default async function CertificatesPage() {
  // initialize supabase on the server
  const supabase = await createClient();
  // get logged-in user
  // Check authentication using getClaims() for better performance
  const {
    user,
    error: authError
  } = await getAuthUser();
  if (authError || !user) {
    return redirect("/login?redirect=/certificates");
  }

  // fetch this user’s certificates
    const certificatesResult = await withRetryableSupabaseQuery(() => supabase
    .from("certificates")
    .select(`
      *,
      projects!inner(
        project_timezone
      )
    `)
    .eq("user_id", user.id)
    .order("issued_at", { ascending: false }));

    const { data: certificates, error: certError } = certificatesResult as {
      data: Certificate[] | null;
      error: { message?: string } | null;
    };
  if (certError) {
    console.error("Error loading certificates:", certError);
    return <p className="p-4 text-destructive">Failed to load certificates.</p>;
  }

  return (
    <main className="mx-auto py-8 px-4 sm:px-12">
      <CertificatesList 
          certificates={certificates || []}
        user={{
          name:
            (user.user_metadata as { full_name?: string } | null)?.full_name ||
            user.email?.split('@')[0] ||
            'User',
          email: user.email || ''
        }} 
      />
    </main>
  );
}
