"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendSystemNotification } from "../actions";
import { UserSearch } from "./components/UserSearch";

const initialState = {
    error: "",
    success: false,
    message: "",
};

export default function AdminNotificationsPage() {
    // Mode: 'broadcast' (all), 'specific' (one user)
    const [mode, setMode] = useState<"broadcast" | "specific">("broadcast");
    const [selectedUserId, setSelectedUserId] = useState("");

    const [, formAction, isPending] = useActionState(async (prev: { error?: string; success?: boolean; message?: string } | null, formData: FormData) => {
        // Enforce validations client/state side before submit if needed or let action handle it
        if (mode === "specific" && !selectedUserId) {
            toast.error("Please select a user");
            return { error: "Please select a user", success: false, message: "" };
        }

        const result = await sendSystemNotification(prev, formData);
        if (result.success) {
            toast.success(result.message);
        } else if (result.error) {
            toast.error(result.error);
        }
        return result;
    }, initialState);

    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">Notifications</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Send System Notification</CardTitle>
                        <CardDescription>
                            Send a notification to a specific user or broadcast to everyone.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form action={formAction} className="space-y-6">

                            <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                                <Label className="text-base">Recipient Type</Label>
                                <div className="flex items-center space-x-4">
                                    <div className="flex items-center space-x-2">
                                        <Switch
                                            id="broadcast-mode"
                                            checked={mode === "broadcast"}
                                            onCheckedChange={(checked) => {
                                                setMode(checked ? "broadcast" : "specific");
                                                if (checked) setSelectedUserId("all");
                                                else setSelectedUserId("");
                                            }}
                                        />
                                        <Label htmlFor="broadcast-mode">
                                            {mode === "broadcast" ? "Broadcast to All Users" : "Specific User"}
                                        </Label>
                                    </div>
                                </div>

                                {mode === "specific" && (
                                    <div className="pt-2 animate-in fade-in slide-in-from-top-2">
                                        <Label>Search User</Label>
                                        <div className="mt-1.5">
                                            <UserSearch
                                                onSelect={(id) => setSelectedUserId(id)}
                                                selectedUserId={selectedUserId}
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Hidden Input for Form Submission */}
                                <input
                                    type="hidden"
                                    name="targetUserId"
                                    value={mode === "broadcast" ? "all" : selectedUserId}
                                />
                            </div>

                            <div className="space-y-3">
                                <Label>Severity</Label>
                                <RadioGroup defaultValue="info" name="severity" className="flex gap-4">
                                    <div className="flex items-center space-x-2 border p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                                        <RadioGroupItem value="info" id="r-info" />
                                        <Label htmlFor="r-info" className="cursor-pointer">Info</Label>
                                    </div>
                                    <div className="flex items-center space-x-2 border p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                                        <RadioGroupItem value="warning" id="r-warning" />
                                        <Label htmlFor="r-warning" className="cursor-pointer">Warning</Label>
                                    </div>
                                    <div className="flex items-center space-x-2 border p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                                        <RadioGroupItem value="success" id="r-success" />
                                        <Label htmlFor="r-success" className="cursor-pointer">Success</Label>
                                    </div>
                                </RadioGroup>
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="title">Title</Label>
                                <Input id="title" name="title" placeholder="Notification Title" required />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="body">Message Body</Label>
                                <Textarea id="body" name="body" placeholder="Type your message here." required />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="actionUrl">Action URL (Optional)</Label>
                                <Input id="actionUrl" name="actionUrl" placeholder="/dashboard" />
                            </div>

                            <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
                                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Send Notification
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
