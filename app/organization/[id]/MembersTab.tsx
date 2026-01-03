"use client";

import type { OrganizationRole } from "@/types";
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
import { 
  MoreHorizontal, 
  Search, 
  Shield, 
  UserRoundCog, 
  UserRound,
  X,
  Users,
  ArrowUpDown, 
  ChevronDown, 
  ChevronUp,
  Eye,
  Clock,
  Download,
  Loader2
} from "lucide-react";
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
import { Card } from "@/components/ui/card";
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getMemberVolunteerHours } from "./member-hours-actions";
import MemberDetailsDialog from "./MemberDetailsDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";

type SortField = "role" | "joined_at" | "hours" | "events";
type SortDirection = "asc" | "desc";

interface Sort {
  field: SortField;
  direction: SortDirection;
}

interface MemberProfileShape {
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

interface Member {
  id: string;
  user_id: string;
  role: OrganizationRole;
  joined_at: string;
  profiles?: MemberProfileShape | MemberProfileShape[] | null;
}

interface MembersTabProps {
  members: Member[];
  userRole: OrganizationRole | null;
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
  const [filteredMembers, setFilteredMembers] = useState<Member[]>([]);
  const [processingMember, setProcessingMember] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<{ id: string; name: string } | null>(null);
  const [sort, setSort] = useState<Sort>({ field: "role", direction: "asc" });
  const [memberHours, setMemberHours] = useState<Record<string, { totalHours: number; eventCount: number; lastEventDate?: string }>>({});
  const [loadingHours, setLoadingHours] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Load member hours for admins and staff
  useEffect(() => {
    const canViewHours = userRole === "admin" || userRole === "staff";
    if (canViewHours && organizationId) {
      loadMemberHours();
    }
  }, [userRole, organizationId, dateRange]);

  const loadMemberHours = async () => {
    setLoadingHours(true);
    try {
      const dateRangeParam = dateRange?.from && dateRange?.to 
        ? { from: dateRange.from, to: dateRange.to }
        : undefined;
      const result = await getMemberVolunteerHours(organizationId, dateRangeParam);
      if (!result.error) {
        setMemberHours(result.memberHours);
      }
    } catch (error) {
      console.error("Error loading member hours:", error);
    } finally {
      setLoadingHours(false);
    }
  };

  // Updated useEffect to handle sorting
  useEffect(() => {
    if (!Array.isArray(members)) {
      console.error("MembersTab: Cannot filter, 'members' prop is not an array");
      return;
    }

    let result = [...members];

    // Apply search filter
    if (searchTerm.trim() !== "") {
      const lowercasedFilter = searchTerm.toLowerCase();
      result = result.filter((member) => {
        const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
        const fullName = profile?.full_name?.toLowerCase() || "";
        const username = profile?.username?.toLowerCase() || "";
        return fullName.includes(lowercasedFilter) || 
               username.includes(lowercasedFilter);
      });
    }

    // Apply sorting
    result.sort((a, b) => {
      const direction = sort.direction === "asc" ? 1 : -1;
      
      if (sort.field === "role") {
        // Custom role order: admin > staff > member
        const roleOrder = { admin: 3, staff: 2, member: 1 };
        return (roleOrder[a.role as keyof typeof roleOrder] - roleOrder[b.role as keyof typeof roleOrder]) * direction;
      }
      
      if (sort.field === "joined_at") {
        return (new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()) * direction;
      }
      
      if (sort.field === "hours") {
        const aHours = memberHours[a.user_id]?.totalHours || 0;
        const bHours = memberHours[b.user_id]?.totalHours || 0;
        return (aHours - bHours) * direction;
      }
      
      if (sort.field === "events") {
        const aEvents = memberHours[a.user_id]?.eventCount || 0;
        const bEvents = memberHours[b.user_id]?.eventCount || 0;
        return (aEvents - bEvents) * direction;
      }
      
      return 0;
    });

    setFilteredMembers(result);
  }, [searchTerm, members, sort, memberHours]);

  // Log filtered members when they change
  useEffect(() => {
    console.log("Current filteredMembers state:", filteredMembers);
  }, [filteredMembers]);

  const canManageMembers = userRole === "admin" || userRole === "staff";
  const isAdmin = userRole === "admin";
  const canViewHours = userRole === "admin" || userRole === "staff";

  // Helper function to format hours as "Xh Ym"
  const formatHours = (hours: number): string => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  const handleViewDetails = (member: Member) => {
    setSelectedMember(member);
    setIsDetailsOpen(true);
  };

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      // Create simple hours export data
      const exportData = [];
      
      for (const member of filteredMembers) {
        const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
        const memberName = profile?.full_name || "Unknown User";
        const username = profile?.username || "";
        const totalHours = memberHours[member.user_id]?.totalHours || 0;
        const eventCount = memberHours[member.user_id]?.eventCount || 0;
        
        exportData.push({
          memberName,
          username,
          role: member.role,
          joinedDate: `"${format(new Date(member.joined_at), "MMM d, yyyy")}"`,
          totalHours: formatHours(totalHours),
          eventCount
        });
      }
      
      // Generate CSV
      const headers = [
        "Member Name", "Username", "Role", "Joined Date", "Total Hours", "Events Attended"
      ];
      const csvRows = [headers.join(",")];
      
      exportData.forEach(row => {
        const csvRow = [
          `"${row.memberName}"`,
          row.username,
          row.role,
          row.joinedDate,
          row.totalHours,
          row.eventCount
        ].join(",");
        csvRows.push(csvRow);
      });
      
      const csvData = csvRows.join("\n");
      const blob = new Blob([csvData], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Create filename with date range if applicable
      const today = new Date().toISOString().split('T')[0];
      let filename = `member-hours-${today}`;
      if (dateRange?.from && dateRange?.to) {
        const fromDate = format(dateRange.from, "yyyy-MM-dd");
        const toDate = format(new Date(dateRange.to.getTime() - 24 * 60 * 60 * 1000), "yyyy-MM-dd");
        filename = `member-hours-${fromDate}-to-${toDate}`;
      } else {
        filename = `member-hours-lifetime-${today}`;
      }
      a.download = `${filename}.csv`;
      
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success("Member hours exported successfully");
    } catch (error) {
      console.error("Error exporting member hours:", error);
      toast.error("Failed to export member hours");
    } finally {
      setIsExporting(false);
    }
  };
  
  const handleUpdateRole = async (memberId: string, userId: string, userName: string, newRole: OrganizationRole) => {
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

  if (!Array.isArray(members)) {
    console.error("MembersTab: 'members' prop is not an array:", members);
    return (
      <div className="p-4 text-center text-destructive">
        Error: Invalid members data provided
      </div>
    );
  }

  const toggleSort = (field: SortField) => {
    setSort(current => ({
      field,
      direction: 
        current.field === field && current.direction === "asc" 
          ? "desc" 
          : "asc"
    }));
  };

  const getSortIcon = (field: SortField) => {
    if (sort.field !== field) return <ArrowUpDown className="h-4 w-4" />;
    return sort.direction === "asc" ? (
      <ChevronUp className="h-4 w-4" />
    ) : (
      <ChevronDown className="h-4 w-4" />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            Organization Members
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {filteredMembers?.length || 0} total members
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          {/* Date Range Filter for admins and staff */}
          {canViewHours && (
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                Date Range:
              </span>
              <DateRangePicker
                value={dateRange}
                onChange={setDateRange}
                placeholder={dateRange?.from ? undefined : "Lifetime (All Time)"}
                showQuickSelect={true}
                className="w-full sm:w-auto"
              />
            </div>
          )}
          
          {/* Export button for admins and staff */}
          {canViewHours && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    onClick={handleExportCSV}
                    disabled={isExporting}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                  >
                    {isExporting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        Export Members
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Export member hours summary</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          
          <div className="relative sm:w-auto min-w-64">
             <div className="relative w-full sm:w-auto sm:flex-1 max-w-md">
            
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search members..."
            className="pl-8 pr-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button 
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchTerm("")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
          </div>
        </div>
        </div>
      </div>

      <Card className="overflow-hidden border rounded-lg">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Member</TableHead>
                <TableHead 
                  className="min-w-[100px] cursor-pointer hover:text-foreground"
                  onClick={() => toggleSort("role")}
                >
                  <div className="flex items-center gap-1">
                    Role
                    {getSortIcon("role")}
                  </div>
                </TableHead>
                {canViewHours && (
                  <>
                    <TableHead 
                      className="min-w-[100px] cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort("hours")}
                    >
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        Hours
                        {getSortIcon("hours")}
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[100px]">
                      <div 
                        className="flex items-center gap-1 cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort("events")}
                      >
                        <Users className="h-4 w-4" />
                        Events
                        {getSortIcon("events")}
                      </div>
                    </TableHead>
                  </>
                )}
                <TableHead 
                  className="min-w-[120px] cursor-pointer hover:text-foreground"
                  onClick={() => toggleSort("joined_at")}
                >
                  <div className="flex items-center gap-1">
                    Joined
                    {getSortIcon("joined_at")}
                  </div>
                </TableHead>
                {canManageMembers && <TableHead className="min-w-[100px] text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMembers && filteredMembers.length > 0 ? (
                filteredMembers.map((member) => {
                  const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
                  return (
                  <TableRow key={member.id} className="hover:bg-muted/30">
                    <TableCell className="py-3 min-w-[200px]">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 flex-shrink-0 border border-border">
                          <AvatarImage
                            src={profile?.avatar_url || undefined}
                            alt={profile?.full_name || ""}
                          />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            <NoAvatar fullName={profile?.full_name || ""} />
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <Link
                            href={`/profile/${profile?.username || ''}`}
                            className="font-medium hover:underline transition-colors block truncate"
                          >
                            {profile?.full_name || "Unknown User"}
                          </Link>
                          {profile?.username && (
                            <p className="text-xs text-muted-foreground truncate">
                              @{profile.username}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[100px]">
                      <RoleBadge role={member.role} />
                    </TableCell>
                    {canViewHours && (
                      <>
                        <TableCell className="min-w-[100px]">
                          {loadingHours ? (
                            <Skeleton className="h-4 w-12" />
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="font-medium text-primary">
                                {formatHours(memberHours[member.user_id]?.totalHours || 0)}
                              </div>
                              {(canViewHours && (isAdmin || userRole === "staff" || member.user_id === currentUserId)) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => handleViewDetails(member)}
                                >
                                  <Eye className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[100px]">
                          {loadingHours ? (
                            <Skeleton className="h-4 w-8" />
                          ) : (
                            <div className="font-medium">
                              {memberHours[member.user_id]?.eventCount || 0}
                            </div>
                          )}
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-sm text-muted-foreground min-w-[120px] whitespace-nowrap">
                      {member.joined_at ? format(new Date(member.joined_at), "MMM d, yyyy") : "N/A"}
                    </TableCell>
                    {canManageMembers && (
                      <TableCell className="text-right">
                        {(isAdmin || (userRole === "staff" && member.role === "member")) &&
                         member.user_id !== currentUserId ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild disabled={processingMember === member.id}>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                {processingMember === member.id ? (
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                                ) : (
                                  <MoreHorizontal className="h-4 w-4" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                Change Role
                              </div>
                              
                              {/* Admin role options */}
                              {isAdmin && (
                                <>
                                  <DropdownMenuItem
                                    className="gap-2"
                                    onClick={() => handleUpdateRole(
                                      member.id, 
                                      member.user_id, 
                                      profile?.full_name || "Member",
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
                                      profile?.full_name || "Member",
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
                                      profile?.full_name || "Member",
                                      "member"
                                    )}
                                    disabled={member.role === "member"}
                                  >
                                    <UserRound className="h-4 w-4" />
                                    Make Member
                                  </DropdownMenuItem>
                                </>
                              )}
                              
                              {/* Staff role options */}
                              {userRole === "staff" && member.role === "member" && (
                                <DropdownMenuItem
                                  className="gap-2"
                                  onClick={() => handleUpdateRole(
                                    member.id, 
                                    member.user_id, 
                                    profile?.full_name || "Member",
                                    "staff"
                                  )}
                                >
                                  <UserRoundCog className="h-4 w-4" />
                                  Make Staff
                                </DropdownMenuItem>
                              )}
                              
                              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                Danger Zone
                              </div>
                              
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                onClick={() => setRemovingMember({
                                  id: member.id,
                                  name: profile?.full_name || "Member"
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
                )})
              ) : (
                <TableRow>
                  <TableCell colSpan={canManageMembers ? (canViewHours ? 6 : 4) : (canViewHours ? 5 : 3)} className="h-32 text-center">
                    {searchTerm ? (
                      <div className="text-muted-foreground">
                        <p>No members found matching &quot;{searchTerm}&quot;</p>
                        <Button 
                          variant="link" 
                          onClick={() => setSearchTerm("")}
                          className="mt-2"
                        >
                          Clear search
                        </Button>
                      </div>
                    ) : (
                      <div className="py-8">
                        <div className="flex justify-center mb-4">
                          <div className="bg-muted/50 h-16 w-16 rounded-full flex items-center justify-center">
                            <Users className="h-8 w-8 text-muted-foreground" />
                          </div>
                        </div>
                        <p className="text-muted-foreground font-medium text-lg">
                          No members in this organization
                        </p>
                        <p className="text-muted-foreground text-sm mt-1">
                          Invite members using the organization join code
                        </p>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

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

      {/* Member Details Dialog */}
      <MemberDetailsDialog
        isOpen={isDetailsOpen}
        onClose={() => {
          setIsDetailsOpen(false);
          setSelectedMember(null);
        }}
        member={selectedMember}
        organizationId={organizationId}
      />
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
