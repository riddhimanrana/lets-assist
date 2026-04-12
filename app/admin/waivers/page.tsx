import { getGlobalWaiverDefinitions } from './actions';
import { GlobalWaiverDefinitionList } from '@/components/admin/GlobalWaiverDefinitionList';
import { CreateDefinitionButton } from './components/CreateDefinitionButton';

export const metadata = {
  title: "Global Waiver Definitions | Admin Console",
  description: "Manage organization-wide waiver definitions.",
};

export default async function AdminWaiversPage() {
  const definitions = await getGlobalWaiverDefinitions();
  
  return (
    <div className="container mx-auto py-8 px-4 md:px-6 max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Global Waiver Definitions</h1>
          <p className="text-muted-foreground mt-2">
            Manage organization-wide waiver definitions. Projects without custom waivers will use the active global definition.
          </p>
        </div>
        <CreateDefinitionButton />
      </div>
      
      <GlobalWaiverDefinitionList definitions={definitions} />
    </div>
  );
}
