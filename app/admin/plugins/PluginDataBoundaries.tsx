import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PluginControlPlaneData } from "./actions";

type Props = { data: PluginControlPlaneData };

function boundaryVariant(
  status: PluginControlPlaneData["dataBoundaries"][number]["boundary_status"],
) {
  if (status === "active") return "default";
  if (status === "migration_pending") return "info";
  if (status === "archived") return "secondary";
  return "outline";
}

export default function PluginDataBoundaries({ data }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data boundaries</CardTitle>
        <CardDescription>
          Review how each organization and plugin pair stores and exposes data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.dataBoundaries.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No plugin data boundaries are registered.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Organization</th>
                  <th className="px-3 py-2 font-medium">Plugin</th>
                  <th className="px-3 py-2 font-medium">Storage</th>
                  <th className="px-3 py-2 font-medium">Client access</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.dataBoundaries.map((boundary) => (
                  <tr key={boundary.id} className="border-t">
                    <td className="px-3 py-3 font-medium">
                      {boundary.organization_name}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {boundary.plugin_key}
                    </td>
                    <td className="px-3 py-3">
                      <div>{boundary.isolation_mode.replaceAll("_", " ")}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {boundary.data_schema}
                        {boundary.data_prefix
                          ? ` / ${boundary.data_prefix}`
                          : ""}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {boundary.direct_client_access.replaceAll("_", " ")}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant={boundaryVariant(boundary.boundary_status)}
                      >
                        {boundary.boundary_status.replaceAll("_", " ")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
