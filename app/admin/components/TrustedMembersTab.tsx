"use client";

import { useEffect, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { ProfileHoverCard } from "@/components/shared/ProfileHoverCard";
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

  useEffect(() => {
    if (!addMemberOpen) {
      setSearchEmail("");
      setSearchResults([]);
    }
  }, [addMemberOpen]);

  useEffect(() => {
    if (!searchEmail.trim()) {
      setSearchResults([]);
    }
  }, [searchEmail]);

  const handleSearch = async () => {
    const trimmed = searchEmail.trim();
    if (!trimmed) {
      toast.error("Enter an email to search");
      return;
    }
    setIsSearching(true);
    try {
      const res = await searchUsersByEmail(trimmed);
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

  const handleApprove = async (id: string, userId?: string) => {
    const targetId = userId || id;
    const res = await updateTrustedMemberStatus(targetId, true);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Member approved");
      router.refresh();
    }
  };

  const handleDeny = async (id: string, userId?: string) => {
    const targetId = userId || id;
    const res = await updateTrustedMemberStatus(targetId, false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Member denied");
      router.refresh();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto">
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
              />
              <Button onClick={handleSearch} disabled={isSearching || !searchEmail.trim()}>
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
                    {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
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

      <div className="space-y-3 lg:hidden">
        {trustedMembers.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No trusted members or applications found.
          </div>
        ) : (
          trustedMembers.map((member) => (
            <div key={member.id} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                {member.profiles?.avatar_url ? (
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={member.profiles.avatar_url} />
                    <AvatarFallback>{member.profiles.full_name?.[0]}</AvatarFallback>
                  </Avatar>
                ) : (
                  <NoAvatar
                    fullName={member.profiles?.full_name || member.name}
                    className="h-10 w-10 rounded-full bg-muted flex items-center justify-center"
                  />
                )}
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{member.profiles?.full_name || member.name}</p>
                    <StatusBadge status={member.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">{member.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Applied {format(new Date(member.created_at), "MMM d, yyyy")}
                  </p>
                </div>
              </div>

              <div className="mt-3 rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Reason</p>
                <p className="mt-2 text-sm text-muted-foreground line-clamp-1 break-words">
                  {member.reason}
                </p>
                <ReasonDialog
                  reason={member.reason}
                  name={member.profiles?.full_name || member.name}
                  email={member.email}
                />
              </div>

              <ActionButtons
                member={member}
                onApprove={handleApprove}
                onDeny={handleDeny}
              />
            </div>
          ))
        )}
      </div>

      <div className="hidden rounded-md border border-border overflow-x-auto lg:block">
        <Table className="min-w-[900px]">
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
                    <ProfileHoverCard
                      username={member.profiles?.username || "unknown"}
                      fullName={member.profiles?.full_name || member.name}
                      avatarUrl={member.profiles?.avatar_url || undefined}
                    >
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
                    </ProfileHoverCard>
                  </TableCell>
                  <TableCell className="min-w-[320px] max-w-[520px]">
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground line-clamp-1 break-words">
                        {member.reason}
                      </p>
                      <ReasonDialog
                        reason={member.reason}
                        name={member.profiles?.full_name || member.name}
                        email={member.email}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={member.status} />
                  </TableCell>
                  <TableCell>{format(new Date(member.created_at), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <ActionButtons
                      member={member}
                      onApprove={handleApprove}
                      onDeny={handleDeny}
                      compact
                    />
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

function StatusBadge({ status }: { status: boolean | null }) {
  if (status === true) {
    return <Badge variant="default" className="bg-primary hover:bg-primary/90">Approved</Badge>;
  }
  if (status === false) {
    return <Badge variant="destructive">Denied</Badge>;
  }
  return <Badge variant="secondary">Pending</Badge>;
}

function ReasonDialog({ reason, name, email }: { reason: string; name: string; email: string }) {
  const shouldShow = reason.length > 80 || reason.includes("\n");
  if (!reason || !shouldShow) {
    return null;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
          View full reason
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Application reason</DialogTitle>
          <DialogDescription>
            {name} · {email}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{reason}</p>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ActionButtons({
  member,
  onApprove,
  onDeny,
  compact = false,
}: {
  member: TrustedMember;
  onApprove: (id: string, userId?: string) => void;
  onDeny: (id: string, userId?: string) => void;
  compact?: boolean;
}) {
  const containerClassName = compact
    ? "flex justify-end gap-2"
    : "mt-4 grid gap-2 sm:flex sm:justify-end";

  return (
    <div className={containerClassName}>
      {member.status === null && (
        <>
          <Button
            size="sm"
            variant={compact ? "outline" : "default"}
            className={compact ? "h-8 w-8 p-0 hover:bg-muted" : "w-full sm:w-auto"}
            onClick={() => onApprove(member.id, member.user_id)}
          >
            <Check className={compact ? "h-4 w-4 text-primary" : "mr-2 h-4 w-4"} />
            {!compact && "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={compact ? "h-8 w-8 p-0 hover:bg-muted" : "w-full sm:w-auto"}
            onClick={() => onDeny(member.id, member.user_id)}
          >
            <X className={compact ? "h-4 w-4 text-destructive" : "mr-2 h-4 w-4"} />
            {!compact && "Deny"}
          </Button>
        </>
      )}

      {member.status === false && (
        <Button
          size="sm"
          variant={compact ? "outline" : "default"}
          className={compact ? "h-8 w-8 p-0 hover:bg-muted" : "w-full sm:w-auto"}
          onClick={() => onApprove(member.id, member.user_id)}
        >
          <Check className={compact ? "h-4 w-4 text-primary" : "mr-2 h-4 w-4"} />
          {!compact && "Approve"}
        </Button>
      )}

      {member.status === true && (
        <Button
          size="sm"
          variant="ghost"
          className={compact ? "h-8 w-8 p-0 hover:bg-destructive/10" : "w-full sm:w-auto text-destructive hover:bg-destructive/10"}
          onClick={() => onDeny(member.id, member.user_id)}
        >
          <Trash2 className={compact ? "h-4 w-4 text-destructive" : "mr-2 h-4 w-4"} />
          {!compact && "Revoke"}
        </Button>
      )}
    </div>
  );
}
