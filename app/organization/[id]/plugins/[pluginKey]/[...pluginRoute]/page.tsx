import { renderOrganizationPluginPage } from "@/lib/plugins/render-organization-plugin-page";

type Props = {
  params: Promise<{ id: string; pluginKey: string; pluginRoute: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OrganizationPluginSubroutePage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id, pluginKey, pluginRoute } = await params;

  return renderOrganizationPluginPage({
    organizationIdentifier: id,
    pluginKey,
    routePath: pluginRoute.join("/"),
    searchParams: await searchParams,
  });
}
