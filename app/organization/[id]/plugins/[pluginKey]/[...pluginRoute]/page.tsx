import { renderOrganizationPluginPage } from "@/lib/plugins/render-organization-plugin-page";

type Props = {
  params: Promise<{ id: string; pluginKey: string; pluginRoute: string[] }>;
};

export default async function OrganizationPluginSubroutePage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id, pluginKey, pluginRoute } = await params;

  return renderOrganizationPluginPage({
    organizationIdentifier: id,
    pluginKey,
    routePath: pluginRoute.join("/"),
  });
}
