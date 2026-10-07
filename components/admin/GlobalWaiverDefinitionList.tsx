import { ExternalLink, FileSignature } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
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

type WaiverDefinitionRow = {
  id: string;
  title: string;
  version: number;
  active: boolean;
  scope?: string | null;
  pdf_public_url?: string | null;
  pdf_storage_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  signers?: Array<unknown> | null;
  fields?: Array<unknown> | null;
};

function formatDate(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function WaiverDefinitionList({
  definitions,
}: {
  definitions: WaiverDefinitionRow[];
}) {
  if (definitions.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileSignature aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No waiver definitions</EmptyTitle>
          <EmptyDescription>
            No project waiver definitions have been created yet.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Signers</TableHead>
            <TableHead>Fields</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="text-right">PDF</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {definitions.map((definition) => {
            const signerCount = definition.signers?.length ?? 0;
            const fieldCount = definition.fields?.length ?? 0;

            return (
              <TableRow key={definition.id}>
                <TableCell className="font-medium">
                  <div className="flex flex-col gap-1">
                    <span>{definition.title}</span>
                    <span className="text-muted-foreground text-xs font-normal">
                      {definition.scope ?? "project"},{" "}
                      <span className="font-mono">
                        {definition.id.slice(0, 8)}
                      </span>
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={definition.active ? "success" : "secondary"}>
                    {definition.active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">
                  v{definition.version}
                </TableCell>
                <TableCell className="tabular-nums">{signerCount}</TableCell>
                <TableCell className="tabular-nums">{fieldCount}</TableCell>
                <TableCell>
                  {formatDate(definition.updated_at ?? definition.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  {definition.pdf_public_url ? (
                    <a
                      href={definition.pdf_public_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open PDF for ${definition.title}`}
                      className={buttonVariants({
                        variant: "ghost",
                        size: "sm",
                      })}
                    >
                      Open
                      <ExternalLink data-icon="inline-end" aria-hidden="true" />
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
