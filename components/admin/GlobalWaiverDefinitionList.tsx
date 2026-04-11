import { Badge } from "@/components/ui/badge";
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

export function GlobalWaiverDefinitionList({
  definitions,
}: {
  definitions: WaiverDefinitionRow[];
}) {
  if (definitions.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
        No global waiver definitions have been created yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card shadow-xs">
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
                    <span className="text-xs text-muted-foreground">
                      {definition.scope ?? "global"} • {definition.id.slice(0, 8)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={definition.active ? "default" : "outline"}>
                    {definition.active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>v{definition.version}</TableCell>
                <TableCell>{signerCount}</TableCell>
                <TableCell>{fieldCount}</TableCell>
                <TableCell>{formatDate(definition.updated_at ?? definition.created_at)}</TableCell>
                <TableCell className="text-right">
                  {definition.pdf_public_url ? (
                    <a
                      href={definition.pdf_public_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-info underline underline-offset-4"
                    >
                      Open
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
    </div>
  );
}