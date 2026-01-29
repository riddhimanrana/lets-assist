"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Lightbulb,
  AlertTriangle,
  MoreHorizontal,
  Loader2,
  Bug,
  ExternalLink,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";

interface FeedbackDialogProps {
  onOpenChangeAction: (open: boolean) => void;
  initialType?: FeedbackType;
}

type FeedbackType = "issue" | "idea" | "other";

export function FeedbackDialog({
  onOpenChangeAction,
  initialType = "issue",
}: FeedbackDialogProps) {
  const { user } = useAuth();
  const [selectedType, setSelectedType] =
    React.useState<FeedbackType>(initialType);
  const [email, setEmail] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [feedback, setFeedback] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [profile, setProfile] = React.useState<{ full_name: string } | null>(
    null,
  );

  const feedbackTypes = [
    {
      id: "issue" as FeedbackType,
      label: "Issue",
      icon: AlertTriangle,
      selectedColor:
        "bg-destructive/10 border-destructive text-destructive ring-1 ring-destructive",
      defaultColor: "bg-background border-input hover:bg-accent hover:text-accent-foreground",
      iconColor: "text-destructive",
    },
    {
      id: "idea" as FeedbackType,
      label: "Idea",
      icon: Lightbulb,
      selectedColor:
        "bg-warning/10 border-warning text-warning ring-1 ring-warning",
      defaultColor: "bg-background border-input hover:bg-accent hover:text-accent-foreground",
      iconColor: "text-warning",
    },
    {
      id: "other" as FeedbackType,
      label: "Other",
      icon: MoreHorizontal,
      selectedColor:
        "bg-info/10 border-info text-info ring-1 ring-info",
      defaultColor: "bg-background border-input hover:bg-accent hover:text-accent-foreground",
      iconColor: "text-info",
    },
  ];

  React.useEffect(() => {
    if (!user?.id) {
      setProfile(null);
      setEmail("");
      return;
    }

    const getProfile = async () => {
      const supabase = createClient();
      const { data: profileData } = (await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single()) as {
          data: { full_name: string } | null;
          error: { message: string } | null;
        };

      setProfile(profileData);
      setEmail(user.email || "");
    };

    getProfile();
  }, [user?.id]);

  const handleSubmit = async () => {
    if (!user) {
      toast.error("Authentication required", {
        description: "Please log in to send feedback.",
      });
      return;
    }

    if (!email.trim() || !title.trim() || !feedback.trim()) {
      toast.error("Missing information", {
        description: "Please fill in all required fields.",
      });
      return;
    }

    if (title.length > 100) {
      toast.error("Title too long", {
        description: "Title must be 100 characters or less.",
      });
      return;
    }

    if (feedback.length > 2000) {
      toast.error("Feedback too long", {
        description: "Feedback must be 2000 characters or less.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();

      const pagePath =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}${window.location.hash}`
          : "";

      const metadata =
        typeof window !== "undefined"
          ? {
            url: window.location.href,
            userAgent: navigator.userAgent,
            screenSize: `${window.screen.width}x${window.screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            language: navigator.language,
            referrer: document.referrer,
            timestamp: new Date().toISOString(),
          }
          : {};

      const { error } = await supabase.from("feedback").insert({
        user_id: user.id,
        section: selectedType,
        email: email.trim(),
        title: title.trim(),
        feedback: feedback.trim(),
        page_path: pagePath || null,
        metadata,
      });

      if (error) {
        throw error;
      }

      toast.success("Feedback sent!", {
        description: "Thank you for your feedback. We'll review it soon.",
      });

      onOpenChangeAction(false);
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toast.error("Error sending feedback", {
        description: "Please try again later.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onOpenChangeAction}>
      <DialogContent className="p-0 border-0 bg-transparent shadow-none sm:max-w-[500px]">
        <DialogTitle className="sr-only">Detail</DialogTitle>
        <Card className="w-full border-border shadow-lg gap-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Lightbulb className="h-4 w-4 text-primary" />
              </span>
              Send Feedback
            </CardTitle>
            <CardDescription>
              Help us improve Let's Assist by sharing your thoughts, ideas, or
              reporting issues.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {user && profile && (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2.5 text-sm text-muted-foreground">
                <div className="h-2 w-2 rounded-full bg-success shrink-0" />
                <span className="truncate">
                  Sending as <span className="font-medium text-foreground">{profile.full_name}</span>
                </span>
              </div>
            )}

            <div className="space-y-3">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Feedback Type
              </Label>
              <div className="grid grid-cols-3 gap-3">
                {feedbackTypes.map((type) => {
                  const Icon = type.icon;
                  const isSelected = selectedType === type.id;

                  return (
                    <button
                      key={type.id}
                      onClick={() => setSelectedType(type.id)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        isSelected ? type.selectedColor : type.defaultColor,
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-5 w-5 transition-colors",
                          isSelected ? type.iconColor : "text-muted-foreground",
                        )}
                      />
                      <span className="text-xs font-medium">{type.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Subject</Label>
              <Input
                id="title"
                placeholder="What's on your mind?"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 100))}
                className="bg-background"
              />
            </div>

            <div className="space-y-2 pb-2">
              <div className="flex justify-between">
                <Label htmlFor="feedback">Description</Label>
                <span className="text-xs text-muted-foreground">
                  {feedback.length}/2000
                </span>
              </div>
              <Textarea
                id="feedback"
                placeholder="Please include as much detail as possible..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value.slice(0, 2000))}
                className="min-h-[120px] resize-none bg-background"
              />
            </div>


          </CardContent>
          <CardFooter className="flex h-14 py-0 items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChangeAction(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !title.trim() ||
                !feedback.trim() ||
                isSubmitting ||
                title.length > 100 ||
                feedback.length > 2000
              }
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Submit Feedback
            </Button>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
