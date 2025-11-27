"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X, Trash2, Plus, Search, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { NoAvatar } from "@/components/NoAvatar";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { searchUsersByEmail, addTrustedMember, updateTrustedMemberStatus } from "../actions";
import { toast } from "sonner";

interface TrustedMember {
  id: string;
  user_id?: string;
  status: boolean | null;
  created_at: string;
  email: string;
  name: string;
  reason: string;
  profiles?: {
    id?: string;
    full_name: string | null;
    email?: string | null;
    avatar_url?: string | null;
    username?: string | null;
  } | null;
}

interface TrustedMembersTabProps {
  trustedMembers: TrustedMember[];
}

export function TrustedMembersTab({ trustedMembers }: TrustedMembersTabProps) {
  const router = useRouter();
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [searchEmail, setSearchEmail] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    id: string;
    email: string;
    full_name?: string | null;
    avatar_url?: string | null;
    username?: string | null;
  }[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  const handleSearch = async () => {
    if (!searchEmail) return;
    setIsSearching(true);
    try {
      const res = await searchUsersByEmail(searchEmail);
      if (res.error) {
        toast.error(res.error);
      } else {
        setSearchResults(res.data || []);
      }
    } catch {
      toast.error("Failed to search users");
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddMember = async (user: { id: string; email: string; full_name?: string | null }) => {
    setIsAdding(true);
    try {
      const res = await addTrustedMember(user.id, user.email, user.full_name || user.email);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Member added successfully");
        setAddMemberOpen(false);
        setSearchEmail("");
        setSearchResults([]);
        router.refresh(); 
      }
    } catch {
      toast.error("Failed to add member");
    } finally {
      setIsAdding(false);
    }
  };

  const handleApprove = async (id: string, userId: string) => {
    const res = await updateTrustedMemberStatus(userId || id, true);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Member approved");
      router.refresh();
    }
  };

  const handleDeny = async (id: string, userId: string) => {
    const res = await updateTrustedMemberStatus(userId || id, false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Member denied");
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Trusted Member</DialogTitle>
              <DialogDescription>
                Search for a user by email to grant them trusted status.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 py-4">
              <Input 
                placeholder="user@example.com" 
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <Button onClick={handleSearch} disabled={isSearching}>
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {searchResults.map((user) => (
                <div key={user.id} className="flex items-center justify-between p-2 border rounded-md hover:bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.avatar_url || undefined} />
                      <AvatarFallback>{user.full_name?.[0] || user.email[0]}</AvatarFallback>
                    </Avatar>
                    <div className="text-sm">
                      <p className="font-medium">{user.full_name || 'No Name'}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => handleAddMember(user)} disabled={isAdding}>
                    Add
                  </Button>
                </div>
              ))}
              {searchResults.length === 0 && searchEmail && !isSearching && (
                <p className="text-sm text-muted-foreground text-center py-2">No users found.</p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setAddMemberOpen(false)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>User</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Applied</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trustedMembers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No trusted members or applications found.
                </TableCell>
              </TableRow>
            ) : (
              trustedMembers.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <HoverCard>
                      <HoverCardTrigger asChild>
                        <div className="flex items-center gap-3 cursor-pointer">
                          {member.profiles?.avatar_url ? (
                            <Avatar>
                              <AvatarImage src={member.profiles.avatar_url} />
                              <AvatarFallback>{member.profiles.full_name?.[0]}</AvatarFallback>
                            </Avatar>
                          ) : (
                            <NoAvatar fullName={member.profiles?.full_name || member.name} className="h-10 w-10 rounded-full bg-muted flex items-center justify-center" />
                          )}
                          <div>
                            <div className="font-medium">{member.profiles?.full_name || member.name}</div>
                            <div className="text-sm text-muted-foreground">{member.email}</div>
                          </div>
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent>
                        <div className="flex justify-between space-x-4">
                          {member.profiles?.avatar_url ? (
                            <Avatar>
                              <AvatarImage src={member.profiles.avatar_url} />
                              <AvatarFallback>{member.profiles.full_name?.[0]}</AvatarFallback>
                            </Avatar>
                          ) : (
                            <NoAvatar fullName={member.profiles?.full_name || member.name} className="h-10 w-10 rounded-full bg-muted flex items-center justify-center" />
                          )}
                          <div className="space-y-1">
                            <h4 className="text-sm font-semibold">{member.profiles?.full_name || member.name}</h4>
                            <p className="text-sm text-muted-foreground">{member.email}</p>
                            {member.profiles?.username && (
                              <p className="text-xs text-muted-foreground">@{member.profiles.username}</p>
                            )}
                          </div>
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={member.reason}>
                    {member.reason}
                  </TableCell>
                  <TableCell>
                    {member.status === true && <Badge variant="default" className="bg-primary hover:bg-primary/90">Approved</Badge>}
                    {member.status === false && <Badge variant="destructive">Denied</Badge>}
                    {member.status === null && <Badge variant="secondary">Pending</Badge>}
                  </TableCell>
                  <TableCell>{format(new Date(member.created_at), 'MMM d, yyyy')}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {/* Pending: Can Approve or Deny */}
                      {member.status === null && (
                        <>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-8 w-8 p-0 hover:bg-muted"
                            onClick={() => handleApprove(member.id, member.user_id!)}
                            title="Approve"
                          >
                            <Check className="h-4 w-4 text-primary" />
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-8 w-8 p-0 hover:bg-muted"
                            onClick={() => handleDeny(member.id, member.user_id!)}
                            title="Deny"
                          >
                            <X className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                      
                      {/* Denied: Can Approve */}
                      {member.status === false && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-8 w-8 p-0 hover:bg-muted"
                          onClick={() => handleApprove(member.id, member.user_id!)}
                          title="Approve"
                        >
                          <Check className="h-4 w-4 text-primary" />
                        </Button>
                      )}

                      {/* Approved: Can Revoke */}
                      {member.status === true && (
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-8 w-8 p-0 hover:bg-destructive/10"
                          onClick={() => handleDeny(member.id, member.user_id!)}
                          title="Revoke"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
