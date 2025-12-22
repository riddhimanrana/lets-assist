"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Download } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface MembersClientProps {
  organizationId: string;
  members: Array<{
    id: string;
    userId?: string;
    name?: string;
    email?: string;
    avatar?: string | null;
    role: string;
    status: string;
    joinedAt: string;
    lastActivityAt: string | null;
    canVerifyHours: boolean;
  }>;
  userRole: string;
}

export default function MembersClient({
  organizationId: _organizationId,
  members,
  userRole,
}: MembersClientProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");

  const isAdmin = userRole === "admin";

  // Filter members
  const filteredMembers = members.filter((member) => {
    const matchesSearch =
      (member.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (member.email || "").toLowerCase().includes(searchTerm.toLowerCase());

    const matchesRole = roleFilter === "all" || member.role === roleFilter;
    const matchesStatus = statusFilter === "all" || member.status === statusFilter;

    return matchesSearch && matchesRole && matchesStatus;
  });

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Members Directory</h1>
          <p className="text-muted-foreground mt-1">
            Manage {members.length} organization member
            {members.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 text-muted-foreground -translate-y-1/2" />
                <Input
                  placeholder="Search by name or email..."
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="w-full md:w-48">
              <label className="text-sm font-medium mb-2 block">Role</label>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-full md:w-48">
              <label className="text-sm font-medium mb-2 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Members Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {filteredMembers.length} Member
            {filteredMembers.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredMembers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No members found matching your filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left font-medium py-3 px-4">Member</th>
                    <th className="text-left font-medium py-3 px-4">Email</th>
                    <th className="text-left font-medium py-3 px-4">Role</th>
                    <th className="text-left font-medium py-3 px-4">Status</th>
                    <th className="text-left font-medium py-3 px-4">Joined</th>
                    <th className="text-left font-medium py-3 px-4">
                      Last Activity
                    </th>
                    {isAdmin && (
                      <th className="text-left font-medium py-3 px-4">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((member) => (
                    <tr key={member.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={member.avatar || undefined} />
                            <AvatarFallback>
                              {member.name?.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{member.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {member.email}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={
                            member.role === "admin"
                              ? "default"
                              : "secondary"
                          }
                          className="capitalize"
                        >
                          {member.role}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={
                            member.status === "active"
                              ? "secondary"
                              : "outline"
                          }
                          className={cn(
                            "capitalize",
                            member.status === "inactive" &&
                              "text-muted-foreground"
                          )}
                        >
                          {member.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {formatDate(member.joinedAt)}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {member.lastActivityAt
                          ? formatDate(member.lastActivityAt)
                          : "—"}
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-4">
                          <Button variant="ghost" size="sm">
                            Manage
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
