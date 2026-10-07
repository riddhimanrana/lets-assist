"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Search } from "lucide-react";

import { SectionHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { humanize, statusTone } from "../components/admin-status";
import {
  bulkUpsertOrganizationPluginEntitlements,
  upsertOrganizationPluginEntitlement,
  type PluginControlPlaneData,
} from "./actions";
import { SelectField } from "./PluginSelectField";

type Props = { data: PluginControlPlaneData; selectedPluginKey: string };
type Entitlement = PluginControlPlaneData["entitlements"][number];

export default function PluginAccessControls({
  data,
  selectedPluginKey,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const privatePlugins = data.plugins.filter(
    (plugin) => plugin.visibility === "private",
  );
  const [organizationId, setOrganizationId] = useState(
    data.organizations[0]?.id ?? "",
  );
  const [pluginKey, setPluginKey] = useState(
    selectedPluginKey || privatePlugins[0]?.key || "",
  );
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [isForced, setIsForced] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (selectedPluginKey) setPluginKey(selectedPluginKey);
  }, [selectedPluginKey]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data.entitlements;
    return data.entitlements.filter((row) =>
      [row.organization_name, row.organization_slug, row.plugin_key, row.status]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [data.entitlements, search]);

  const save = () => {
    startTransition(async () => {
      const result = await upsertOrganizationPluginEntitlement({
        organizationId,
        pluginKey,
        status,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        isForced,
      });
      if (!result.success) {
        toast.error(result.error || "Access was not saved");
        return;
      }
      toast.success("Organization access saved");
      router.refresh();
    });
  };

  const edit = (row: Entitlement) => {
    setOrganizationId(row.organization_id);
    setPluginKey(row.plugin_key);
    setStatus(row.status);
    setIsForced(row.is_forced);
    setStartsAt(row.starts_at?.slice(0, 16) ?? "");
    setEndsAt(row.ends_at?.slice(0, 16) ?? "");
  };

  return (
    <div className="grid gap-8">
      <SettingsSection
        title="Organization access"
        description="Choose an organization and plugin, then grant or revoke access."
        footer={
          <>
            <BulkAccessDialog data={data} />
            <Button
              onClick={save}
              disabled={isPending || !organizationId || !pluginKey}
            >
              {isPending ? "Saving…" : "Save access"}
            </Button>
          </>
        }
      >
        <div className="grid gap-5 md:grid-cols-2">
          <SelectField
            label="Organization"
            value={organizationId}
            onChange={setOrganizationId}
            items={data.organizations.map((row) => ({
              value: row.id,
              label: row.name,
            }))}
          />
          <SelectField
            label="Plugin"
            value={pluginKey}
            onChange={setPluginKey}
            items={privatePlugins.map((row) => ({
              value: row.key,
              label: row.name,
            }))}
          />
          <SelectField
            label="Access"
            value={status}
            onChange={(value) => setStatus(value as typeof status)}
            items={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
          <Field orientation="horizontal" className="md:self-end">
            <FieldContent>
              <FieldLabel htmlFor="access-platform-controlled">
                Platform controlled
              </FieldLabel>
              <FieldDescription>
                Organization admins cannot override this grant.
              </FieldDescription>
            </FieldContent>
            <Switch
              id="access-platform-controlled"
              checked={isForced}
              onCheckedChange={setIsForced}
            />
          </Field>
          <DateField
            label="Starts at"
            value={startsAt}
            onChange={setStartsAt}
          />
          <DateField label="Ends at" value={endsAt} onChange={setEndsAt} />
        </div>
      </SettingsSection>

      <section className="grid gap-3">
        <SectionHeader
          title="Current grants"
          description={`${data.entitlements.length} organization-plugin grants`}
          actions={
            <InputGroup className="w-full sm:w-72">
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search access grants"
                placeholder="Search organization or plugin"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </InputGroup>
          }
        />
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Organization</TableHead>
                <TableHead>Plugin</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Window</TableHead>
                <TableHead className="pr-4">
                  <span className="sr-only">Edit</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-4 font-medium">
                    {row.organization_name}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.plugin_key}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={statusTone(row.status)}>
                        {humanize(row.status)}
                      </Badge>
                      {row.is_forced ? (
                        <Badge variant="outline">Locked</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatWindow(row.starts_at, row.ends_at)}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button variant="ghost" onClick={() => edit(row)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function BulkAccessDialog({ data }: { data: PluginControlPlaneData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const privatePlugins = data.plugins.filter(
    (plugin) => plugin.visibility === "private",
  );
  const [pluginKey, setPluginKey] = useState(privatePlugins[0]?.key ?? "");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [identifiers, setIdentifiers] = useState("");
  const [isForced, setIsForced] = useState(false);

  const save = () =>
    startTransition(async () => {
      const result = await bulkUpsertOrganizationPluginEntitlements({
        pluginKey,
        organizationIdentifiers: identifiers,
        status,
        isForced,
      });
      if (!result.success) {
        toast.error(result.error || "Bulk access update failed");
        return;
      }
      toast.success(result.message || "Bulk access updated");
      if (result.unmatchedIdentifiers?.length)
        toast.info(`Unmatched: ${result.unmatchedIdentifiers.join(", ")}`);
      router.refresh();
    });

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline">Bulk access</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk organization access</DialogTitle>
          <DialogDescription>
            Paste organization IDs or usernames separated by spaces, commas, or
            lines.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-5">
          <SelectField
            label="Plugin"
            value={pluginKey}
            onChange={setPluginKey}
            items={privatePlugins.map((row) => ({
              value: row.key,
              label: row.name,
            }))}
          />
          <SelectField
            label="Access"
            value={status}
            onChange={(value) => setStatus(value as typeof status)}
            items={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
          <Field>
            <FieldLabel htmlFor="bulk-access-organizations">
              Organizations
            </FieldLabel>
            <Textarea
              id="bulk-access-organizations"
              rows={7}
              value={identifiers}
              onChange={(event) => setIdentifiers(event.target.value)}
            />
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="bulk-access-platform-controlled">
              Platform controlled
            </FieldLabel>
            <Switch
              id="bulk-access-platform-controlled"
              checked={isForced}
              onCheckedChange={setIsForced}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            onClick={save}
            disabled={isPending || !pluginKey || !identifiers.trim()}
          >
            {isPending ? "Saving…" : "Apply access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function formatWindow(startsAt: string | null, endsAt: string | null) {
  return `${startsAt ? new Date(startsAt).toLocaleDateString() : "Any time"} to ${endsAt ? new Date(endsAt).toLocaleDateString() : "No expiry"}`;
}
