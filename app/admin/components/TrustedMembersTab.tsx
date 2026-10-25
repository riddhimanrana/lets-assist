"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { ShieldCheckIcon, useAnimatedIcon } from "@/components/icons/animated";
import { PageHeader } from "@/components/layout/PageHeader";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

import { searchUsers, addTrustedMember } from "../actions";
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
  const [searchResults, setSearchResults] = useState<
    {
      id: string;
      email: string;
      full_name?: string | null;
      avatar_url?: string | null;
      username?: string | null;
    }[]
  >([]);
  const [isAdding, setIsAdding] = useState(false);
  const addIcon = useAnimatedIcon();

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

  const handleAddMember = async (user: {
    id: string;
    email: string;
    full_name?: string | null;
  }) => {
    setIsAdding(true);
    try {
      const res = await addTrustedMember(
        user.id,
        user.email,
        user.full_name || user.email,
      );
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
    <>
      <PageHeader
        title="Trusted members"
        description="Review applications and manage trusted member status for users."
        actions={
          <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
            <DialogTrigger
              render={
                <Button
                  className="w-full sm:w-auto"
                  {...addIcon.triggerProps}
                />
              }
            >
              <ShieldCheckIcon
                ref={addIcon.ref}
                size={16}
                aria-hidden="true"
                data-icon="inline-start"
              />
              Add trusted member
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add trusted member</DialogTitle>
                <DialogDescription>
                  Search for a user by email to grant them trusted status.
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <InputGroup>
                  <InputGroupAddon>
                    <Search aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="User email"
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
                </InputGroup>
                <Button
                  onClick={handleSearch}
                  disabled={isSearching || !searchEmail.trim()}
                  variant="outline"
                >
                  {isSearching ? (
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : null}
                  Search
                </Button>
              </div>

              <ul className="max-h-75 divide-y overflow-y-auto">
                {searchResults.map((user) => (
                  <li
                    key={user.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage
                          src={user.avatar_url || undefined}
                          alt={user.full_name || "User"}
                        />
                        <AvatarFallback>
                          <NoAvatar
                            fullName={
                              user.full_name || user.email.split("@")[0]
                            }
                          />
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {user.full_name || user.email.split("@")[0]}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {user.email}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => handleAddMember(user)}
                      disabled={isAdding}
                      className="shrink-0"
                    >
                      {isAdding ? <Loader2 className="animate-spin" /> : "Add"}
                    </Button>
                  </li>
                ))}
                {searchResults.length === 0 && searchEmail && !isSearching && (
                  <li className="text-muted-foreground py-6 text-center text-sm">
                    No users found.
                  </li>
                )}
              </ul>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAddMemberOpen(false)}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <DataTable columns={columns} data={trustedMembers} />
    </>
  );
}
