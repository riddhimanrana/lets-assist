import { renderOrganizationPluginPage } from "@/lib/plugins/render-organization-plugin-page";

type Props = {
  params: Promise<{ id: string; pluginKey: string }>;
};

export default async function OrganizationPluginPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id, pluginKey } = await params;
  return renderOrganizationPluginPage({
    organizationIdentifier: id,
    pluginKey,
  });
}
