"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NoAvatar } from "@/components/NoAvatar";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { ChevronDown, MoreHorizontal, Search, Shield, UserRoundCog, UserRound } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { updateMemberRole, removeMember } from "./actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MembersTabProps {
  members: any[];
  userRole: string | null;
  organizationId: string;
  currentUserId: string | undefined;
}

export default function MembersTab({
  members,
  userRole,
  organizationId,
  currentUserId,
}: MembersTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredMembers, setFilteredMembers] = useState(members);
  const [processingMember, setProcessingMember] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<{ id: string; name: string } | null>(null);

  // Filter members when search term changes
  useEffect(() => {
    if (searchTerm.trim() === "") {
      setFilteredMembers(members);
      return;
    }

    const lowercasedFilter = searchTerm.toLowerCase();
    const filtered = members.filter((member) => {
      const fullName = member.profiles?.full_name?.toLowerCase() || "";
      const username = member.profiles?.username?.toLowerCase() || "";
      return fullName.includes(lowercasedFilter) || 
             username.includes(lowercasedFilter);
    });
    setFilteredMembers(filtered);
  }, [searchTerm, members]);

  const canManageMembers = userRole === "admin" || userRole === "staff";
  const isAdmin = userRole === "admin";
  
  const handleUpdateRole = async (memberId: string, userId: string, userName: string, newRole: string) => {
    if (userId === currentUserId && newRole !== "admin") {
      toast.error("You cannot demote yourself. Another admin must change your role.");
      return;
    }
    
    setProcessingMember(memberId);
    try {
      const result = await updateMemberRole(organizationId, memberId, newRole);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`${userName}'s role updated to ${newRole}`);
        
        // Update local state to reflect the change
        setFilteredMembers(prevMembers => 
          prevMembers.map(member => 
            member.id === memberId ? {...member, role: newRole} : member
          )
        );
      }
    } catch (error) {
      console.error("Error updating member role:", error);
      toast.error("Failed to update member role");
    } finally {
      setProcessingMember(null);
    }
  };
  
  const handleRemoveConfirm = async () => {
    if (!removingMember) return;
    
    setProcessingMember(removingMember.id);
    try {
      const result = await removeMember(organizationId, removingMember.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`${removingMember.name} has been removed from the organization`);
        
        // Update local state to remove the member
        setFilteredMembers(prevMembers => 
          prevMembers.filter(member => member.id !== removingMember.id)
        );
      }
    } catch (error) {
      console.error("Error removing member:", error);
      toast.error("Failed to remove member");
    } finally {
      setProcessingMember(null);
      setRemovingMember(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between gap-2">
        <h2 className="text-xl font-semibold">Organization Members</h2>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search members..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              {canManageMembers && <TableHead className="w-[100px]">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMembers.length > 0 ? (
              filteredMembers.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage
                        src={member.profiles?.avatar_url || undefined}
                        alt={member.profiles?.full_name || ""}
                      />
                      <AvatarFallback>
                        <NoAvatar fullName={member.profiles?.full_name || ""} />
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <Link
                        href={`/profile/${member.profiles?.username}`}
                        className="font-medium hover:underline"
                      >
                        {member.profiles?.full_name || "Unknown User"}
                      </Link>
                      {member.profiles?.username && (
                        <p className="text-xs text-muted-foreground">
                          @{member.profiles.username}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={member.role} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(member.joined_at), "MMM d, yyyy")}
                  </TableCell>
                  {canManageMembers && (
                    <TableCell>
                      {/* Check if current user can manage this member */}
                      {(isAdmin || (userRole === "staff" && member.role === "member")) &&
                       member.user_id !== currentUserId ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild disabled={processingMember === member.id}>
                            <Button variant="ghost" size="icon">
                              {processingMember === member.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent"></div>
                              ) : (
                                <MoreHorizontal className="h-4 w-4" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {/* Admin can change to any role */}
                            {isAdmin && (
                              <>
                                <DropdownMenuItem
                                  className="gap-2"
                                  onClick={() => handleUpdateRole(
                                    member.id, 
                                    member.user_id, 
                                    member.profiles?.full_name || "Member",
                                    "admin"
                                  )}
                                  disabled={member.role === "admin"}
                                >
                                  <Shield className="h-4 w-4" />
                                  Make Admin
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2"
                                  onClick={() => handleUpdateRole(
                                    member.id, 
                                    member.user_id, 
                                    member.profiles?.full_name || "Member",
                                    "staff"
                                  )}
                                  disabled={member.role === "staff"}
                                >
                                  <UserRoundCog className="h-4 w-4" />
                                  Make Staff
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2"
                                  onClick={() => handleUpdateRole(
                                    member.id, 
                                    member.user_id, 
                                    member.profiles?.full_name || "Member",
                                    "member"
                                  )}
                                  disabled={member.role === "member"}
                                >
                                  <UserRound className="h-4 w-4" />
                                  Make Member
                                </DropdownMenuItem>
                              </>
                            )}
                            
                            {/* Staff can only change regular members */}
                            {userRole === "staff" && member.role === "member" && (
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() => handleUpdateRole(
                                  member.id, 
                                  member.user_id, 
                                  member.profiles?.full_name || "Member",
                                  "staff"
                                )}
                              >
                                <UserRoundCog className="h-4 w-4" />
                                Make Staff
                              </DropdownMenuItem>
                            )}
                            
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive focus:bg-destructive/10"
                              onClick={() => setRemovingMember({
                                id: member.id,
                                name: member.profiles?.full_name || "Member"
                              })}
                            >
                              Remove from Organization
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <div className="w-4 h-4"></div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={canManageMembers ? 4 : 3} className="h-24 text-center">
                  {searchTerm ? (
                    <div className="text-muted-foreground">
                      No members found matching &quot;{searchTerm}&quot;
                    </div>
                  ) : (
                    <div className="text-muted-foreground">
                      No members in this organization
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Remove Member Dialog */}
      <Dialog
        open={!!removingMember}
        onOpenChange={(open) => !open && setRemovingMember(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {removingMember?.name} from this organization? 
              They will lose access to all organization resources.
            </DialogDescription>
          </DialogHeader>
          
          <DialogFooter className="mt-4 gap-2">
            <Button 
              variant="outline" 
              onClick={() => setRemovingMember(null)}
              disabled={processingMember === removingMember?.id}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleRemoveConfirm}
              disabled={processingMember === removingMember?.id}
            >
              {processingMember === removingMember?.id ? "Removing..." : "Remove Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Helper component for role badges
function RoleBadge({ role }: { role: string }) {
  switch (role) {
    case 'admin':
      return (
        <Badge variant="default" className="gap-1">
          <Shield className="h-3 w-3" />
          Admin
        </Badge>
      );
    case 'staff':
      return (
        <Badge variant="secondary" className="gap-1">
          <UserRoundCog className="h-3 w-3" />
          Staff
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1">
          <UserRound className="h-3 w-3" />
          Member
        </Badge>
      );
  }
}
