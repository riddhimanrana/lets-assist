"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { motion } from "framer-motion"
import { deleteAccount } from "./actions"
import { createClient } from "@/utils/supabase/client"
import { Alert, AlertDescription } from "@/components/ui/alert"

export default function SecurityPage() {
    const [isDeleting, setIsDeleting] = useState(false)
    const [countdown, setCountdown] = useState(5)
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [deleteConfirmation, setDeleteConfirmation] = useState("")
    const [countdownInterval, setCountdownInterval] = useState<NodeJS.Timeout | null>(null)
    const [currentEmail, setCurrentEmail] = useState("")

    useEffect(() => {
        const fetchUserEmail = async () => {
            const supabase = createClient()
            const { data: { session } } = await supabase.auth.getSession()
            if (session?.user?.email) {
                setCurrentEmail(session.user.email)
            }
        }
        fetchUserEmail()
    }, [])

    const handleEmailChange = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        // Functionality coming in future release
    }

    const handlePasswordChange = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        // Functionality coming in future release
    }

    const handleDeleteAccount = async () => {
        if (deleteConfirmation !== "delete my account") {
            toast.error("Please type the confirmation phrase correctly")
            return
        }
        
        try {
            setIsDeleting(true)
            // Start countdown
            let count = 5
            setCountdown(count)
            const interval = setInterval(() => {
                count--
                setCountdown(count)
                if (count === 0) {
                    clearInterval(interval)
                    setCountdownInterval(null)
                }
            }, 1000)
            setCountdownInterval(interval)

            // Wait for 5 seconds
            await new Promise(resolve => setTimeout(resolve, 5000))

            if (count === 0) {
                const result = await deleteAccount()
                if (result.success) {
                    toast.success("Account successfully deleted")
                    // Clear any stored auth state
                    localStorage.clear()
                    sessionStorage.clear()
                    // Force navigation to home page with bypass parameter
                    window.location.href = '/?deleted=true&noRedirect=1'
                }
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to delete account")
            setIsDeleting(false)
        }
        
        setShowDeleteDialog(false)
    }

    const handleCancelDelete = () => {
        if (countdownInterval) {
            clearInterval(countdownInterval)
            setCountdownInterval(null)
        }
        setIsDeleting(false)
        setCountdown(5)
        setShowDeleteDialog(false)
    }

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 sm:p-6"
        >
            <div className="max-w-5xl mx-auto">
                <div className="mb-6">
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Privacy & Security</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage your email, password, and account security
                    </p>
                </div>

                <div className="space-y-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card className="h-full">
                        <CardHeader className="px-5 py-4 sm:px-6">
                            <CardTitle className="text-xl">Email Address</CardTitle>
                            <CardDescription>Change your email address</CardDescription>
                        </CardHeader>
                        <CardContent className="px-5 sm:px-6 py-4">
                            <Alert className="mb-4">
                                <AlertDescription>
                                    Email changes will be available in a future release.
                                </AlertDescription>
                            </Alert>
                            <form onSubmit={handleEmailChange} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="current-email">Current Email</Label>
                                    <Input id="current-email" type="email" value={currentEmail} disabled />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="new-email">New Email</Label>
                                    <Input id="new-email" type="email" required disabled />
                                </div>
                                <Button type="submit" disabled={true} className="w-full sm:w-auto">
                                    Coming Soon
                                </Button>
                            </form>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="px-5 py-4 sm:px-6">
                            <CardTitle className="text-xl">Password</CardTitle>
                            <CardDescription>Change your password</CardDescription>
                        </CardHeader>
                        <CardContent className="px-5 sm:px-6 py-4">
                            <Alert className="mb-4">
                                <AlertDescription>
                                    Password changes will be available in a future release.
                                </AlertDescription>
                            </Alert>
                            <form onSubmit={handlePasswordChange} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="current-password">Current Password</Label>
                                    <Input id="current-password" type="password" required disabled />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="new-password">New Password</Label>
                                    <Input id="new-password" type="password" required disabled />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="confirm-password">Confirm New Password</Label>
                                    <Input id="confirm-password" type="password" required disabled />
                                </div>
                                <Button type="submit" disabled={true} className="w-full sm:w-auto">
                                    Coming Soon
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </div>

                <Card className="border-destructive mt-6">
                    <CardHeader className="px-5 py-4 sm:px-6">
                        <CardTitle className="text-destructive">Delete Account</CardTitle>
                        <CardDescription>
                            Permanently delete your account and all associated data
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="px-5 sm:px-6 py-4">
                        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                            <DialogTrigger asChild>
                                <Button variant="destructive" className="w-full sm:w-auto">Delete Account</Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-lg max-w-[95vw]">
                                <DialogHeader>
                                    <DialogTitle>Are you absolutely sure?</DialogTitle>
                                    <DialogDescription>
                                        This action cannot be undone. This will permanently delete your
                                        account and remove all associated data.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="confirm">
                                            Type &quot;delete my account&quot; to confirm
                                        </Label>
                                        <Input
                                            id="confirm"
                                            value={deleteConfirmation}
                                            onChange={(e) => setDeleteConfirmation(e.target.value)}
                                            placeholder="delete my account"
                                        />
                                    </div>
                                </div>
                                <DialogFooter className="flex-col sm:flex-row gap-2">
                                    <Button
                                        variant="destructive"
                                        onClick={handleDeleteAccount}
                                        disabled={deleteConfirmation !== "delete my account" || isDeleting}
                                        className="w-full sm:w-auto order-2 sm:order-1"
                                    >
                                        {isDeleting 
                                            ? `Deleting in ${countdown}s...` 
                                            : "Delete Account"
                                        }
                                    </Button>
                                    {isDeleting && (
                                        <Button 
                                            variant="secondary" 
                                            onClick={handleCancelDelete}
                                            className="w-full sm:w-auto order-1 sm:order-2"
                                        >
                                            Cancel
                                        </Button>
                                    )}
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </CardContent>
                </Card>
            </div>
        </motion.div>
    )
}