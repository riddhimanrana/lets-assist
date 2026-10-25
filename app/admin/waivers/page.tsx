import { getProjectWaiverDefinitions } from "./actions";
import { PageHeader } from "@/components/layout/PageHeader";
import { AdminPage } from "../components/AdminPage";
import { WaiverDefinitionTable } from "./WaiverDefinitionTable";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin waivers",
  description: "Review project-scoped waiver definitions.",
};

export default async function AdminWaiversPage() {
  const definitions = await getProjectWaiverDefinitions();

  return (
    <AdminPage>
      <PageHeader
        title="Project waiver definitions"
        description="Review the waiver definitions attached to projects. Project managers configure and update waivers from each project's edit flow."
      />
      <WaiverDefinitionTable definitions={definitions} />
    </AdminPage>
  );
}
