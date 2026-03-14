import { getGlobalWaiverTemplates } from './actions';
import { GlobalWaiverTemplateList } from '@/components/admin/GlobalWaiverTemplateList';
import { CreateTemplateButton } from './components/CreateTemplateButton';

export const metadata = {
  title: "Global Waiver Templates | Admin Console",
  description: "Manage organization-wide waiver templates.",
};

export default async function AdminWaiversPage() {
  const templates = await getGlobalWaiverTemplates();
  
  return (
    <div className="container mx-auto py-8 px-4 md:px-6 max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Global Waiver Templates</h1>
          <p className="text-muted-foreground mt-2">
            Manage organization-wide waiver templates. Projects without custom waivers will use the active global template.
          </p>
        </div>
        <CreateTemplateButton />
      </div>
      
      <GlobalWaiverTemplateList templates={templates} />
    </div>
  );
}
