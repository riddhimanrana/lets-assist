import { redirect } from "next/navigation";
import { getAdminClient } from "@/lib/supabase/admin";
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
  project_timezone?: string | null;
  projects?: {
    project_timezone?: string;
  };
};

export const metadata: Metadata = {
  title: "Certificates",
  description: "View and manage your earned volunteer certificates.",
};

export default async function CertificatesPage() {
  // get logged-in user
  // Check authentication using getClaims() for better performance
  const { user, error: authError } = await getAuthUser();
  if (authError || !user) {
    return redirect("/login?redirect=/certificates");
  }

  const admin = getAdminClient();

  const certificatesResult = await withRetryableSupabaseQuery(() =>
    admin
      .from("user_certificate_read_model")
      .select(
        `
      id,
      project_title,
      creator_name,
      is_certified,
      type,
      event_start,
      event_end,
      volunteer_email,
      organization_name,
      project_id,
      schedule_id,
      issued_at,
      signup_id,
      volunteer_name,
      project_location,
      project_timezone
    `,
      )
      .eq("user_id", user.id)
      .order("issued_at", { ascending: false }),
  );

  const { data: certificates, error: certError } = certificatesResult as {
    data: Certificate[] | null;
    error: { message?: string } | null;
  };
  if (certError) {
    console.error("Error loading certificates:", certError);
    return <p className="p-4 text-destructive">Failed to load certificates.</p>;
  }

  const certificateList = (certificates || []).map((certificate) => ({
    ...certificate,
    projects: {
      project_timezone: certificate.project_timezone ?? undefined,
    },
  }));

  return (
    <main className="mx-auto py-8 px-4 sm:px-12">
      <CertificatesList
        certificates={certificateList}
        user={{
          name:
            (user.user_metadata as { full_name?: string } | null)?.full_name ||
            user.email?.split("@")[0] ||
            "User",
          email: user.email || "",
        }}
      />
    </main>
  );
}
