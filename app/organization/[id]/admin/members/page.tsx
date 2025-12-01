import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import MembersClient from "../MembersClient";
import { getOrganizationMembers } from "../actions";

type Props = {
  params: Promise<{ id: string }>;
};

export const metadata = {
  title: "Members Directory",
};

export default async function MembersPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return redirect("/login");
  }

  // Check if user is admin or staff
  const { data: memberData } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", id)
    .eq("user_id", user.id)
    .single();

  if (!memberData || (memberData.role !== "admin" && memberData.role !== "staff")) {
    return notFound();
  }

  // Fetch members
  const members = await getOrganizationMembers(id);

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <MembersClient
        organizationId={id}
        members={members}
        userRole={memberData.role}
      />
    </div>
  );
}
