"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Search, Loader2 } from "lucide-react";
import { NoAvatar } from "@/components/shared/NoAvatar";
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
import { useRouter } from "next/navigation";
import { searchUsers, addTrustedMember } from "../actions";
import { toast } from "sonner";
import { DataTable } from "./trusted-members/data-table";
import { columns, TrustedMember } from "./trusted-members/columns";

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
      const res = await searchUsers(trimmed);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Trusted Members</h2>
          <p className="text-sm text-muted-foreground">Manage and approve trusted member applications.</p>
        </div>
        <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
          <DialogTrigger render={
            <Button className="w-full sm:w-auto">
              <ShieldCheck className="mr-2 h-4 w-4" />
              Add Trusted Member
            </Button>
          } />
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
                      {user.avatar_url ? (
                        <>
                          <AvatarImage src={user.avatar_url} />
                          <AvatarFallback>
                            {user.full_name
                              ? user.full_name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .slice(0, 2)
                                  .join("")
                                  .toUpperCase()
                              : user.email[0].toUpperCase()}
                          </AvatarFallback>
                        </>
                      ) : (
                        <AvatarFallback>
                          <NoAvatar fullName={user.full_name || user.email.split("@")[0]} />
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{user.full_name || user.email.split("@")[0]}</p>
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

      <DataTable columns={columns} data={trustedMembers} />
    </div>
  );
}