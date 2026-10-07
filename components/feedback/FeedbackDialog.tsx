"use client";
import { safeConsole } from "@/lib/safe-console";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Lightbulb,
  AlertTriangle,
  MoreHorizontal,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

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

  const feedbackTypes: Array<{
    id: FeedbackType;
    label: string;
    icon: typeof Lightbulb;
  }> = [
    { id: "issue", label: "Issue", icon: AlertTriangle },
    { id: "idea", label: "Idea", icon: Lightbulb },
    { id: "other", label: "Other", icon: MoreHorizontal },
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
      safeConsole.error("Error submitting feedback:", error);
      toast.error("Error sending feedback", {
        description: "Please try again later.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Help us improve Let&apos;s Assist by sharing your thoughts, ideas,
            or reporting issues.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-4">
          <Field>
            <FieldTitle id="feedback-type-label">Feedback type</FieldTitle>
            <ToggleGroup
              aria-labelledby="feedback-type-label"
              variant="outline"
              className="w-full"
              value={[selectedType]}
              onValueChange={(value) => {
                const next = value[0] as FeedbackType | undefined;
                if (next) setSelectedType(next);
              }}
            >
              {feedbackTypes.map((type) => {
                const Icon = type.icon;

                return (
                  <ToggleGroupItem
                    key={type.id}
                    value={type.id}
                    className="flex-1"
                  >
                    <Icon aria-hidden="true" />
                    {type.label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor="title">Subject</FieldLabel>
            <Input
              id="title"
              placeholder="What's on your mind?"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 100))}
            />
          </Field>

          <Field>
            <div className="flex items-baseline justify-between gap-2">
              <FieldLabel htmlFor="feedback">Description</FieldLabel>
              <span className="text-muted-foreground text-xs tabular-nums">
                {feedback.length}/2000
              </span>
            </div>
            <Textarea
              id="feedback"
              placeholder="Please include as much detail as possible..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value.slice(0, 2000))}
              className="min-h-30 resize-none"
            />
          </Field>
        </FieldGroup>

        <DialogFooter className="sm:items-center sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:order-last sm:flex-row">
            <Button
              variant="outline"
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
                <Loader2
                  data-icon="inline-start"
                  aria-hidden="true"
                  className="animate-spin"
                />
              )}
              Submit feedback
            </Button>
          </div>
          <p className="text-muted-foreground min-w-0 truncate text-sm">
            {user && profile ? (
              <>
                Sending as{" "}
                <span className="text-foreground font-medium">
                  {profile.full_name}
                </span>
              </>
            ) : null}
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
