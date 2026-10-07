"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateOrganizationVerifiedStatus } from "../actions";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
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
      const result = await updateOrganizationVerifiedStatus(
        organizationId,
        nextValue,
      );

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

      toast.success(
        nextValue
          ? "Organization marked as verified"
          : "Organization verification removed",
      );
      setUpdatingId(null);
      router.refresh();
    });
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <InputGroup className="sm:max-w-sm">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search organizations"
            placeholder="Search organizations by name, username, or type..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
        <p className="text-muted-foreground text-sm whitespace-nowrap">
          {filteredRows.length} organization
          {filteredRows.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">Organization</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="pr-4">Verified</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="whitespace-normal">
                  <Empty className="p-8">
                    <EmptyHeader>
                      <EmptyTitle className="text-base">
                        No organizations match your search.
                      </EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
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
                  <TableRow key={org.id}>
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          <AvatarImage
                            src={org.logo_url || undefined}
                            alt={org.name}
                          />
                          <AvatarFallback>
                            <NoAvatar fullName={org.name} />
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="max-w-64 truncate font-medium">
                            {org.name}
                          </p>
                          <p className="text-muted-foreground max-w-64 truncate text-xs">
                            @{org.username}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {org.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {createdAtText}
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex min-h-9 items-center gap-3">
                        <Switch
                          checked={org.verified === true}
                          onCheckedChange={(checked) =>
                            handleToggle(org.id, checked)
                          }
                          disabled={isPending || isUpdatingThisRow}
                          aria-label={`Toggle verification for ${org.name}`}
                        />
                        <span className="text-muted-foreground text-xs">
                          {isUpdatingThisRow
                            ? "Saving..."
                            : org.verified
                              ? "Verified"
                              : "Unverified"}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
