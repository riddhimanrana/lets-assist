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
import { cn } from "@/lib/utils";
import { Check, X, Trash2, Search, Loader2, ShieldCheck } from "lucide-react";
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
import { Card } from "@/components/ui/card";

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Trusted Members</h2>
          <p className="text-sm text-muted-foreground">Manage and approve trusted member applications.</p>
        </div>
        <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto">
              <ShieldCheck className="mr-2 h-4 w-4" />
              Add Trusted Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Trusted Member</DialogTitle>
              <DialogDescription>
                Search for a user by email to grant them trusted status.
              </DialogDescription>
            </DialogHeader>
            <div className="relative py-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <div className="flex gap-2">
                <Input
                  placeholder="user@example.com"
                  className="pl-9"
                  value={searchEmail}
                  onChange={(e) => setSearchEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearch();
                    }
                  }}
                />
                <Button onClick={handleSearch} disabled={isSearching || !searchEmail.trim()} size="icon" variant="secondary">
                  {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {searchResults.map((user) => (
                <div key={user.id} className="flex items-center justify-between p-3 border rounded-xl hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary">{user.full_name?.[0] || user.email[0]}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{user.full_name || 'No Name'}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => handleAddMember(user)} disabled={isAdding} className="ml-2 shrink-0">
                    {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                  </Button>
                </div>
              ))}
              {searchResults.length === 0 && searchEmail && !isSearching && (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">No users found.</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setAddMemberOpen(false)} className="w-full sm:w-auto">Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 lg:hidden">
        {trustedMembers.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center">
            <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground/20" />
            <p className="mt-4 text-sm text-muted-foreground">No trusted members found.</p>
          </div>
        ) : (
          trustedMembers.map((member) => (
            <Card key={member.id} className="p-4 shadow-none">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {member.profiles?.avatar_url ? (
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={member.profiles.avatar_url} />
                      <AvatarFallback>{member.profiles.full_name?.[0]}</AvatarFallback>
                    </Avatar>
                  ) : (
                    <NoAvatar
                      fullName={member.profiles?.full_name || member.name}
                      className="h-12 w-12 rounded-full"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{member.profiles?.full_name || member.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                  </div>
                </div>
                <StatusBadge status={member.status} />
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Application Reason</span>
                    <span className="text-[10px] text-muted-foreground">{format(new Date(member.created_at), "MMM d, yyyy")}</span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed italic">
                    "{member.reason}"
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
            </Card>
          )) 
        )}
      </div>

      <div className="hidden rounded-xl border bg-card lg:block overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-[300px]">User</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[150px]">Applied</TableHead>
              <TableHead className="text-right w-[150px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trustedMembers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No trusted members or applications found.
                </TableCell>
              </TableRow>
            ) : (
              trustedMembers.map((member) => (
                <TableRow key={member.id} className="hover:bg-muted/10 transition-colors">
                  <TableCell>
                    <ProfileHoverCard
                      username={member.profiles?.username || "unknown"}
                      fullName={member.profiles?.full_name || member.name}
                      avatarUrl={member.profiles?.avatar_url || undefined}
                    >
                      <div className="flex items-center gap-3 py-1">
                        {member.profiles?.avatar_url ? (
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={member.profiles.avatar_url} />
                            <AvatarFallback>{member.profiles.full_name?.[0]}</AvatarFallback>
                          </Avatar>
                        ) : (
                          <NoAvatar fullName={member.profiles?.full_name || member.name} className="h-10 w-10 rounded-full" />
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{member.profiles?.full_name || member.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{member.email}</div>
                        </div>
                      </div>
                    </ProfileHoverCard>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[400px]">
                      <p className="text-sm text-muted-foreground line-clamp-1 italic">
                        "{member.reason}"
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
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(member.created_at), "MMM d, yyyy")}
                  </TableCell>
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
    return <Badge className="rounded-full px-3 py-0.5 bg-emerald-500/10 text-emerald-600 border-emerald-200 hover:bg-emerald-500/20 shadow-none">Approved</Badge>;
  }
  if (status === false) {
    return <Badge variant="destructive" className="rounded-full px-3 py-0.5 shadow-none">Denied</Badge>;
  }
  return <Badge variant="secondary" className="rounded-full px-3 py-0.5 shadow-none">Pending</Badge>;
}

function ReasonDialog({ reason, name, email }: { reason: string; name: string; email: string }) {
  const shouldShow = reason.length > 80 || reason.includes("\n");
  if (!reason || !shouldShow) {
    return null;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="link" size="sm" className="h-auto p-0 text-xs font-semibold text-primary">
          View full reason
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Application Reason</DialogTitle>
          <DialogDescription className="flex items-center gap-2 mt-1">
            <span className="font-medium text-foreground">{name}</span>
            <span className="text-muted-foreground">({email})</span>
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="mt-4 max-h-[40vh] rounded-xl border bg-muted/30 p-4">
          <p className="text-sm leading-relaxed whitespace-pre-wrap italic">"{reason}"</p>
        </ScrollArea>
        <DialogFooter>
          <Button variant="secondary" onClick={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            const dialog = btn.closest('[role="dialog"]') as HTMLElement;
            const closeBtn = dialog?.querySelector('[data-radix-collection-item]') as HTMLElement;
            closeBtn?.click();
          }}>Close</Button>
        </DialogFooter>
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
    ? "flex justify-end gap-1"
    : "flex flex-col sm:flex-row justify-end gap-2";

  return (
    <div className={containerClassName}>
      {member.status === null && (
        <>
          <Button
            size={compact ? "icon" : "sm"}
            variant={compact ? "ghost" : "default"}
            className={compact ? "h-8 w-8 text-emerald-600 hover:bg-emerald-500/10" : "w-full sm:w-auto"}
            onClick={() => onApprove(member.id, member.user_id)}
          >
            <Check className={compact ? "h-4 w-4" : "mr-2 h-4 w-4"} />
            {!compact && "Approve"}
          </Button>
          <Button
            size={compact ? "icon" : "sm"}
            variant={compact ? "ghost" : "outline"}
            className={compact ? "h-8 w-8 text-destructive hover:bg-destructive/10" : "w-full sm:w-auto"}
            onClick={() => onDeny(member.id, member.user_id)}
          >
            <X className={compact ? "h-4 w-4" : "mr-2 h-4 w-4"} />
            {!compact && "Deny"}
          </Button>
        </>
      )}

      {member.status === false && (
        <Button
          size={compact ? "icon" : "sm"}
          variant={compact ? "ghost" : "default"}
          className={compact ? "h-8 w-8 text-emerald-600 hover:bg-emerald-500/10" : "w-full sm:w-auto"}
          onClick={() => onApprove(member.id, member.user_id)}
        >
          <Check className={compact ? "h-4 w-4" : "mr-2 h-4 w-4"} />
          {!compact && "Approve"}
        </Button>
      )}

      {member.status === true && (
        <Button
          size={compact ? "icon" : "sm"}
          variant="ghost"
          className={compact ? "h-8 w-8 text-destructive hover:bg-destructive/10" : "w-full sm:w-auto text-destructive hover:bg-destructive/10"}
          onClick={() => onDeny(member.id, member.user_id)}
        >
          <Trash2 className={compact ? "h-4 w-4" : "mr-2 h-4 w-4"} />
          {!compact && "Revoke"}
        </Button>
      )}
    </div>
  );
}