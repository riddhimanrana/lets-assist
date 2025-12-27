"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, AlertCircle, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
    addEmail,
    unlinkEmail,
    setPrimaryEmail,
    getLinkedIdentities,
    verifyEmail,
} from "@/utils/auth/account-management";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UserEmail {
    id: string;
    email: string;
    is_primary: boolean;
    verified_at: string | null;
}

export function EmailManager() {
    const [emails, setEmails] = useState<UserEmail[]>([]);
    const [loading, setLoading] = useState(true);
    const [newEmail, setNewEmail] = useState("");
    const [adding, setAdding] = useState(false);
    const [verificationStep, setVerificationStep] = useState(false);
    const [verificationCode, setVerificationCode] = useState("");
    const [pendingEmail, setPendingEmail] = useState("");
    const [verifying, setVerifying] = useState(false);

    useEffect(() => {
        fetchEmails();
    }, []);

    const fetchEmails = async () => {
        try {
            const data = await getLinkedIdentities();
            setEmails(data as UserEmail[]);
        } catch (error) {
            console.error("Failed to fetch emails:", error);
            toast.error("Failed to load email addresses");
        } finally {
            setLoading(false);
        }
    };

    const handleAddEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEmail) return;

        setAdding(true);
        try {
            const result = await addEmail(newEmail);
            if (result.error && result.warning) {
                toast.warning(result.error);
                setAdding(false);
                return;
            }

            if (result.error) {
                toast.error(result.error);
                setAdding(false);
                return;
            }

            setPendingEmail(newEmail);
            setVerificationStep(true);
            toast.success("Verification code sent to " + newEmail);
        } catch (error: unknown) {
            console.error("Error adding email:", error);
            const message = error instanceof Error ? error.message : "Failed to add email";
            toast.error(message);
        } finally {
            setAdding(false);
        }
    };

    const handleVerifyEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!verificationCode) return;

        setVerifying(true);
        try {
            await verifyEmail(pendingEmail, verificationCode);
            toast.success("Email verified successfully");
            setVerificationStep(false);
            setNewEmail("");
            setVerificationCode("");
            setPendingEmail("");
            fetchEmails();
        } catch (error: any) {
            console.error("Error verifying email:", error);
            toast.error(error.message || "Invalid verification code");
        } finally {
            setVerifying(false);
        }
    };

    const handleRemoveEmail = async (id: string) => {
        try {
            await unlinkEmail(id);
            toast.success("Email removed successfully");
            fetchEmails();
        } catch (error: any) {
            console.error("Error removing email:", error);
            toast.error(error.message || "Failed to remove email");
        }
    };

    const handleSetPrimary = async (email: string, verified: boolean) => {
        if (!verified) {
            toast.error("Only verified emails can be set as primary.");
            return;
        }

        try {
            const result = await setPrimaryEmail(email);
            if ((result as any).needsConfirmation) {
                toast.info("Supabase sent a confirmation email to the new address.");
            } else {
                toast.success("Primary email updated");
            }
            setTimeout(fetchEmails, 500);
        } catch (error: any) {
            console.error("Error setting primary email:", error);
            toast.error(error.message || "Failed to update primary email");
        }
    };

    if (loading) {
        return (
            <Card>
                <CardContent className="pt-6 flex justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Email Addresses</CardTitle>
                <CardDescription>
                    Manage the email addresses associated with your account.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-4">
                    {emails.map((email) => {
                        const isVerified = Boolean(email.verified_at);
                        return (
                            <div
                                key={email.id}
                                className="flex items-center justify-between p-4 border rounded-lg"
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Mail className="h-4 w-4 text-muted-foreground" />
                                        <span className="font-medium">{email.email}</span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span
                                            className={
                                                isVerified
                                                    ? "text-emerald-600 font-semibold"
                                                    : "text-amber-600 font-semibold"
                                            }
                                        >
                                            {isVerified ? "Verified" : "Unverified"}
                                        </span>
                                        {email.is_primary && (
                                            <Badge variant="secondary" className="text-xs">
                                                Primary
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="sm" className="p-1">
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-48">
                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                        <DropdownMenuItem
                                            onSelect={() => handleSetPrimary(email.email, isVerified)}
                                            disabled={!isVerified || email.is_primary}
                                        >
                                            {email.is_primary ? "Already primary" : "Make primary"}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onSelect={() => handleRemoveEmail(email.id)}
                                            disabled={email.is_primary}
                                        >
                                            Remove email
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        );
                    })}
                </div>

                {!verificationStep ? (
                    <form onSubmit={handleAddEmail} className="flex gap-2">
                        <div className="grid w-full items-center gap-1.5">
                            <Label htmlFor="email">Add new email</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="Enter email address"
                                    value={newEmail}
                                    onChange={(e) => setNewEmail(e.target.value)}
                                    required
                                />
                                <Button type="submit" disabled={adding}>
                                    {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Add
                                </Button>
                            </div>
                        </div>
                    </form>
                ) : (
                    <div className="space-y-4 border p-4 rounded-lg bg-muted/20">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <AlertCircle className="h-4 w-4" />
                            <span>Verification code sent to <strong>{pendingEmail}</strong></span>
                        </div>
                        <form onSubmit={handleVerifyEmail} className="flex gap-2">
                            <div className="grid w-full items-center gap-1.5">
                                <Label htmlFor="code">Verification Code</Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="code"
                                        type="text"
                                        placeholder="123456"
                                        value={verificationCode}
                                        onChange={(e) => setVerificationCode(e.target.value)}
                                        required
                                        maxLength={6}
                                    />
                                    <Button type="submit" disabled={verifying}>
                                        {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Verify
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => {
                                            setVerificationStep(false);
                                            setVerificationCode("");
                                            setPendingEmail("");
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        </form>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
