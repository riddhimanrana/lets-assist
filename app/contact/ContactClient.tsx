"use client";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lightbulb, Bug, Mail } from "lucide-react";
import Link from "next/link";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { toast } from "sonner";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export default function ContactClient() {
    const { user } = useAuth(); // Use centralized auth hook
    const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
    const [feedbackType, setFeedbackType] = useState<"issue" | "idea" | "other">("issue");

    const handleSuggestFeature = () => {
        if (!user) {
            toast.error("Authentication required", {
                description: "You need to be logged in to send feedback.",
            });
            return;
        }
        setFeedbackType("idea");
        setShowFeedbackDialog(true);
    };

    const handleReportBug = () => {
        if (!user) {
            toast.error("Authentication required", {
                description: "You need to be logged in to report a bug.",
            });
            return;
        }
        setFeedbackType("issue");
        setShowFeedbackDialog(true);
    };

    return (
        <>
            <div className="container mx-auto py-6 md:py-12 px-4 sm:px-6 lg:px-8 max-w-7xl">
                <div className="text-center mb-8 md:mb-12">
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3 md:mb-4">
                        Get in Touch
                    </h1>
                    <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
                        Have a question, suggestion, or found a bug? We&apos;re here to help!
                    </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    {/* Feature Suggestions Card */}
                    <Card className="relative group hover:shadow-lg transition-shadow">
                        <CardHeader className="space-y-2 md:space-y-3">
                            <div className="mb-2 md:mb-4 w-10 h-10 md:w-12 md:h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Lightbulb className="h-5 w-5 md:h-6 md:w-6 text-primary" />
                            </div>
                            <CardTitle className="text-lg md:text-xl">
                                Have a cool feature idea?
                            </CardTitle>
                            <CardDescription className="text-sm md:text-base">
                                Vote on upcoming features or suggest your own to help us improve
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button className="w-full" onClick={handleSuggestFeature}>
                                Suggest Feature
                            </Button>
                        </CardContent>
                    </Card>
                    {/* Bug Reports Card */}
                    <Card className="relative group hover:shadow-lg transition-shadow">
                        <CardHeader className="space-y-2 md:space-y-3">
                            <div className="mb-2 md:mb-4 w-10 h-10 md:w-12 md:h-12 rounded-lg bg-destructive/10 flex items-center justify-center">
                                <Bug className="h-5 w-5 md:h-6 md:w-6 text-destructive" />
                            </div>
                            <CardTitle className="text-lg md:text-xl">Found a bug?</CardTitle>
                            <CardDescription className="text-sm md:text-base">
                                UI glitches or app not working? Let us know and we&apos;ll fix it
                                ASAP
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button variant="destructive" className="w-full" onClick={handleReportBug}>
                                Report Bug
                            </Button>
                        </CardContent>
                    </Card>
                    {/* Support Card */}
                    <Card className="relative group hover:shadow-lg transition-shadow">
                        <CardHeader className="space-y-2 md:space-y-3">
                            <div className="mb-2 md:mb-4 w-10 h-10 md:w-12 md:h-12 rounded-lg bg-chart-3/10 flex items-center justify-center">
                                <Mail className="h-5 w-5 md:h-6 md:w-6 text-chart-3" />
                            </div>
                            <CardTitle className="text-lg md:text-xl">Need help?</CardTitle>
                            <CardDescription className="text-sm md:text-base">
                                Contact our support team for any other questions or assistance
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button className="w-full bg-chart-3 hover:bg-chart-3/90" asChild>
                                <Link href="mailto:support@lets-assist.com">Contact Support</Link>
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
            {showFeedbackDialog && (
                <FeedbackDialog 
                    onOpenChangeAction={setShowFeedbackDialog} 
                    initialType={feedbackType}
                />
            )}
        </>
    );
}
