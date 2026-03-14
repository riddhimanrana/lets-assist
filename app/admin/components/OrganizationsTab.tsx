"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateOrganizationVerifiedStatus } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/shared/NoAvatar";

export type AdminOrganization = {
  id: string;
  name: string;
  username: string;
  type: string;
  verified: boolean | null;
  created_at: string | null;
  logo_url: string | null;
};

interface OrganizationsTabProps {
  organizations: AdminOrganization[];
}

export function OrganizationsTab({ organizations }: OrganizationsTabProps) {
  const router = useRouter();
  const [rows, setRows] = useState(organizations);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;

    return rows.filter((org) => {
      return (
        org.name.toLowerCase().includes(term) ||
        org.username.toLowerCase().includes(term) ||
        org.type.toLowerCase().includes(term)
      );
    });
  }, [rows, search]);

  const handleToggle = (organizationId: string, nextValue: boolean) => {
    startTransition(async () => {
      setUpdatingId(organizationId);
      const result = await updateOrganizationVerifiedStatus(organizationId, nextValue);

      if (result?.error) {
        toast.error(result.error);
        setUpdatingId(null);
        return;
      }

      setRows((prev) =>
        prev.map((org) =>
          org.id === organizationId
            ? {
                ...org,
                verified: nextValue,
              }
            : org,
        ),
      );

      toast.success(nextValue ? "Organization marked as verified" : "Organization verification removed");
      setUpdatingId(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search organizations by name, username, or type..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-xl"
        />
        <p className="text-sm text-muted-foreground whitespace-nowrap">
          {filteredRows.length} organization{filteredRows.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Organization</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
                <th className="px-4 py-3 text-left font-medium">Verified</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                    No organizations match your search.
                  </td>
                </tr>
              ) : (
                filteredRows.map((org) => {
                  const isUpdatingThisRow = updatingId === org.id;
                  const createdAtText = org.created_at
                    ? new Date(org.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—";

                  return (
                    <tr key={org.id} className="border-t hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9 border">
                            <AvatarImage src={org.logo_url || undefined} alt={org.name} />
                            <AvatarFallback>
                              <NoAvatar fullName={org.name} />
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{org.name}</p>
                            <p className="text-xs text-muted-foreground truncate">@{org.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="capitalize">
                          {org.type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{createdAtText}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={org.verified === true}
                            onCheckedChange={(checked) => handleToggle(org.id, checked)}
                            disabled={isPending || isUpdatingThisRow}
                            aria-label={`Toggle verification for ${org.name}`}
                          />
                          <span className="text-xs text-muted-foreground">
                            {isUpdatingThisRow ? "Saving..." : org.verified ? "Verified" : "Unverified"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
