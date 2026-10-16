import { renderOrganizationPluginPage } from "@/lib/plugins/render-organization-plugin-page";

type Props = {
  params: Promise<{ id: string; pluginKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OrganizationPluginPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id, pluginKey } = await params;
  return renderOrganizationPluginPage({
    organizationIdentifier: id,
    pluginKey,
    searchParams: await searchParams,
  });
}
