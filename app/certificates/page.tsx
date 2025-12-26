
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { CertificatesList } from "./CertificatesList";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Certificates",
  description: "View and manage your earned volunteer certificates.",
};


export default async function CertificatesPage() {
  // initialize supabase on the server
  const supabase = await createClient();
  // get logged-in user
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return redirect("/login?redirect=/certificates");
  }

  // fetch this user’s certificates
  const { data: certificates, error: certError } = await supabase
    .from("certificates")
    .select(`
      *,
      projects!inner(
        project_timezone
      )
    `)
    .eq("user_id", user.id)
    .order("issued_at", { ascending: false });
  if (certError) {
    console.error("Error loading certificates:", certError);
    return <p className="p-4 text-destructive">Failed to load certificates.</p>;
  }

  return (
    <main className="mx-auto py-8 px-4 sm:px-12">
      <CertificatesList 
        certificates={certificates || []} 
        user={{
          name: user.user_metadata.full_name || user.email?.split('@')[0] || 'User',
          email: user.email || ''
        }} 
      />
    </main>
  );
}
