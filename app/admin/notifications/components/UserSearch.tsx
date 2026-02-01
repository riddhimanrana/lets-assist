"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { searchUsers } from "../../actions";

interface UserSearchProps {
    onSelect: (userId: string) => void;
    selectedUserId?: string;
    className?: string;
}

export function UserSearch({ onSelect, selectedUserId, className }: UserSearchProps) {
    const [open, setOpen] = React.useState(false);
    const [value, setValue] = React.useState(selectedUserId || "");
    const [query, setQuery] = React.useState("");
    const [items, setItems] = React.useState<{ id: string; label: string; email: string; avatar_url?: string }[]>([]);
    const [loading, setLoading] = React.useState(false);

    // Debounced search effect
    React.useEffect(() => {
        if (!open) return;

        // Initial fetch to show some users or if needed
        if (query.trim() === "" && items.length === 0) {
            // Optional: fetch recent users?
            // For now, let's wait for typing
        }

        const timer = setTimeout(async () => {
            if (query.trim().length < 2) return;

            setLoading(true);
            try {
                const result = await searchUsers(query);
                if (result.data) {
                    setItems(result.data.map(u => ({
                        id: u.id,
                        label: u.full_name || u.email || "Unknown",
                        email: u.email || "",
                        avatar_url: u.avatar_url || undefined
                    })));
                }
            } catch (e) {
                console.error("Search failed", e);
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [query, open]);

    const selectedItem = items.find((item) => item.id === value);
    const selectedLabel = selectedItem?.label;
    const selectedAvatar = selectedItem?.avatar_url;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                className={cn(buttonVariants({ variant: "outline" }), "w-full justify-between h-auto py-2", className)}
                role="combobox"
                aria-expanded={open}
            >
                <div className="flex items-center gap-2 text-left">
                    {value ? (
                        <>
                            {selectedAvatar && (
                                <Avatar className="h-6 w-6">
                                    <AvatarImage src={selectedAvatar} />
                                    <AvatarFallback>{selectedLabel?.charAt(0)}</AvatarFallback>
                                </Avatar>
                            )}
                            <div className="flex flex-col">
                                <span className="font-medium">{selectedLabel || "Selected User"}</span>
                                {value && <span className="text-xs text-muted-foreground hidden sm:inline-block">({value.slice(0, 8)}...)</span>}
                            </div>
                        </>
                    ) : (
                        "Search user by name..."
                    )}
                </div>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Search users..."
                        value={query}
                        onValueChange={setQuery}
                    />
                    <CommandList>
                        {loading ? (
                            <div className="py-6 flex justify-center text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Searching...
                            </div>
                        ) : (
                            <>
                                <CommandEmpty>No users found.</CommandEmpty>
                                <CommandGroup>
                                    {items.map((item) => (
                                        <CommandItem
                                            key={item.id}
                                            value={item.id}
                                            onSelect={(currentValue) => {
                                                setValue(currentValue === value ? "" : currentValue);
                                                onSelect(currentValue === value ? "" : currentValue);
                                                setOpen(false);
                                            }}
                                        >
                                            <Check
                                                className={cn(
                                                    "mr-2 h-4 w-4",
                                                    value === item.id ? "opacity-100" : "opacity-0"
                                                )}
                                            />
                                            <div className="flex items-center gap-2 w-full">
                                                <Avatar className="h-8 w-8">
                                                    <AvatarImage src={item.avatar_url} />
                                                    <AvatarFallback>{item.label.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="flex flex-col">
                                                    <span>{item.label}</span>
                                                    <span className="text-xs text-muted-foreground">{item.email}</span>
                                                </div>
                                            </div>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
