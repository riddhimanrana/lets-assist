"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  bulkUpsertOrganizationPluginEntitlements,
  upsertOrganizationPluginEntitlement,
  type PluginControlPlaneData,
} from "./actions";

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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Organization access</CardTitle>
          <CardDescription>
            Choose an organization and plugin, then grant or revoke access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
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
            <div className="flex items-end">
              <div className="flex w-full items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>Platform controlled</Label>
                  <p className="text-xs text-muted-foreground">
                    Organization admins cannot override this grant.
                  </p>
                </div>
                <Switch checked={isForced} onCheckedChange={setIsForced} />
              </div>
            </div>
            <DateField
              label="Starts at"
              value={startsAt}
              onChange={setStartsAt}
            />
            <DateField label="Ends at" value={endsAt} onChange={setEndsAt} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={save}
              disabled={isPending || !organizationId || !pluginKey}
            >
              {isPending ? "Saving…" : "Save access"}
            </Button>
            <BulkAccessDialog data={data} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current grants</CardTitle>
          <CardDescription>
            {data.entitlements.length} organization-plugin grants
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            aria-label="Search access grants"
            placeholder="Search organization or plugin"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Organization</th>
                  <th className="px-3 py-2">Plugin</th>
                  <th className="px-3 py-2">Access</th>
                  <th className="px-3 py-2">Window</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-3 font-medium">
                      {row.organization_name}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {row.plugin_key}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant={
                          row.status === "active" ? "default" : "secondary"
                        }
                      >
                        {row.status}
                      </Badge>
                      {row.is_forced ? (
                        <Badge variant="outline" className="ml-1">
                          locked
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {formatWindow(row.starts_at, row.ends_at)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => edit(row)}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
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
        <div className="space-y-2">
          <Label>Organizations</Label>
          <Textarea
            rows={7}
            value={identifiers}
            onChange={(event) => setIdentifiers(event.target.value)}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <Label>Platform controlled</Label>
          <Switch checked={isForced} onCheckedChange={setIsForced} />
        </div>
        <Button
          onClick={save}
          disabled={isPending || !pluginKey || !identifiers.trim()}
        >
          {isPending ? "Saving…" : "Apply access"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function SelectField({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger>
          <SelectValue placeholder={`Choose ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
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
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function formatWindow(startsAt: string | null, endsAt: string | null) {
  return `${startsAt ? new Date(startsAt).toLocaleDateString() : "Any time"} to ${endsAt ? new Date(endsAt).toLocaleDateString() : "No expiry"}`;
}
