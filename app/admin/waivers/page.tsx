import { getProjectWaiverDefinitions } from './actions';
import { WaiverDefinitionList } from '@/components/admin/GlobalWaiverDefinitionList';

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Project Waiver Definitions | Admin Console",
  description: "Review project-scoped waiver definitions.",
};

export default async function AdminWaiversPage() {
  const definitions = await getProjectWaiverDefinitions();
  
  return (
    <div className="container mx-auto py-8 px-4 md:px-6 max-w-7xl">
      <div className="mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Project Waiver Definitions</h1>
          <p className="text-muted-foreground mt-2">
            Review the waiver definitions attached to projects. Project managers configure and update waivers from each project&apos;s edit flow.
          </p>
        </div>
      </div>
      
      <WaiverDefinitionList definitions={definitions} />
    </div>
  );
}
