import { Database } from "lucide-react";

import { SectionHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { humanize, statusTone } from "../components/admin-status";
import type { PluginControlPlaneData } from "./actions";

type Props = { data: PluginControlPlaneData };

export default function PluginDataBoundaries({ data }: Props) {
  return (
    <section className="grid gap-4">
      <SectionHeader
        title="Data boundaries"
        description="Review how each organization and plugin pair stores and exposes data."
      />
      {data.dataBoundaries.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia>
              <Database
                className="text-muted-foreground size-5"
                aria-hidden="true"
              />
            </EmptyMedia>
            <EmptyTitle className="text-base">No data boundaries</EmptyTitle>
            <EmptyDescription>
              No plugin data boundaries are registered.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Organization</TableHead>
                <TableHead>Plugin</TableHead>
                <TableHead>Storage</TableHead>
                <TableHead>Client access</TableHead>
                <TableHead className="pr-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.dataBoundaries.map((boundary) => (
                <TableRow key={boundary.id}>
                  <TableCell className="pl-4 font-medium">
                    {boundary.organization_name}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {boundary.plugin_key}
                  </TableCell>
                  <TableCell>
                    <div>{boundary.isolation_mode.replaceAll("_", " ")}</div>
                    <div className="text-muted-foreground font-mono text-xs">
                      {boundary.data_schema}
                      {boundary.data_prefix ? ` / ${boundary.data_prefix}` : ""}
                    </div>
                  </TableCell>
                  <TableCell>
                    {boundary.direct_client_access.replaceAll("_", " ")}
                  </TableCell>
                  <TableCell className="pr-4">
                    <Badge variant={statusTone(boundary.boundary_status)}>
                      {humanize(boundary.boundary_status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
