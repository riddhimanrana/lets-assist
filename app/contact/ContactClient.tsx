"use client";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    ArrowRight,
    Building2,
    Bug,
    Lightbulb,
    Mail,
    Sparkles,
    type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { toast } from "sonner";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

type ContactActionCard = {
    title: string;
    description: string;
    buttonLabel: string;
    icon: LucideIcon;
    iconClassName: string;
    hoverClassName: string;
    buttonVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
    buttonClassName?: string;
    href?: string;
    onClick?: () => void;
};

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

    const actionCards: ContactActionCard[] = [
        {
            title: "Have a cool feature idea?",
            description:
                "Share product ideas and improvements that can make Let’s Assist more useful for everyone.",
            buttonLabel: "Suggest Feature",
            icon: Lightbulb,
            iconClassName: "border-primary/20 bg-primary/10 text-primary",
            hoverClassName: "hover:border-primary/30",
            buttonVariant: "default",
            onClick: handleSuggestFeature,
        },
        {
            title: "Found a bug?",
            description:
                "Spotted a glitch or broken flow? Report it so we can investigate and patch it quickly.",
            buttonLabel: "Report Bug",
            icon: Bug,
            iconClassName: "border-destructive/20 bg-destructive/10 text-destructive",
            hoverClassName: "hover:border-destructive/30",
            buttonVariant: "destructive",
            onClick: handleReportBug,
        },
        {
            title: "Need help?",
            description:
                "For account or platform support, reach out to our team and we’ll guide you from there.",
            buttonLabel: "Contact Support",
            icon: Mail,
            iconClassName: "border-info/20 bg-info/10 text-info",
            hoverClassName: "hover:border-info/30",
            buttonClassName: "bg-info text-background hover:bg-info/90",
            href: "mailto:support@lets-assist.com",
        },
        {
            title: "Setting up for your organization?",
            description:
                "Looking for a team rollout? We can help with onboarding, setup, and best-practice guidance.",
            buttonLabel: "Talk to Our Team",
            icon: Building2,
            iconClassName: "border-chart-3/20 bg-chart-3/10 text-chart-3",
            hoverClassName: "hover:border-chart-3/30",
            buttonClassName: "bg-chart-3 text-background hover:bg-chart-3/90",
            href: "mailto:contact@lets-assist.com",
        },
    ];

    return (
        <>
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 md:gap-10 md:py-12 lg:px-8">
                <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card p-6 md:p-10">
                    <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-primary/10 via-background to-info/10" />
                    <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-chart-3/15 blur-3xl" />
                    <div className="pointer-events-none absolute -bottom-24 -left-24 size-72 rounded-full bg-primary/15 blur-3xl" />

                    <div className="relative z-10 flex flex-col gap-5">
                        <Badge variant="secondary" className="w-fit">
                            <Sparkles data-icon="inline-start" />
                            We&apos;re listening
                        </Badge>

                        <div className="flex flex-col gap-3">
                            <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
                                Get in touch with the Let&apos;s Assist team
                            </h1>
                            <p className="max-w-3xl text-base text-muted-foreground md:text-lg">
                                Questions, feedback, bug reports, or organizational setup help — pick
                                the option below and we&apos;ll make sure your message gets to the right
                                people.
                            </p>
                        </div>

                        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                            <p className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                                Most messages are reviewed within one business day.
                            </p>
                            <p className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                                Feedback helps prioritize roadmap and quality improvements.
                            </p>
                        </div>
                    </div>
                </section>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {actionCards.map((card) => {
                        const Icon = card.icon;

                        const actionButton = card.href ? (
                            <Button
                                asChild
                                variant={card.buttonVariant ?? "default"}
                                className={cn("w-full justify-between", card.buttonClassName)}
                            >
                                <Link href={card.href}>
                                    {card.buttonLabel}
                                    <ArrowRight data-icon="inline-end" />
                                </Link>
                            </Button>
                        ) : (
                            <Button
                                variant={card.buttonVariant ?? "default"}
                                className="w-full justify-between"
                                onClick={card.onClick}
                            >
                                {card.buttonLabel}
                                <ArrowRight data-icon="inline-end" />
                            </Button>
                        );

                        return (
                            <Card
                                key={card.title}
                                className={cn(
                                    "group flex h-full flex-col overflow-hidden border border-border/70 bg-card/80 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
                                    card.hoverClassName
                                )}
                            >
                                <CardHeader className="flex flex-col gap-4">
                                    <div
                                        className={cn(
                                            "inline-flex size-12 items-center justify-center rounded-xl border",
                                            card.iconClassName
                                        )}
                                    >
                                        <Icon className="size-5" />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <CardTitle className="text-lg md:text-xl">
                                            {card.title}
                                        </CardTitle>
                                        <CardDescription className="text-sm md:text-base">
                                            {card.description}
                                        </CardDescription>
                                    </div>
                                </CardHeader>
                                <CardContent className="mt-auto pt-0">{actionButton}</CardContent>
                            </Card>
                        );
                    })}
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
