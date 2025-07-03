"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Lightbulb, AlertTriangle, MoreHorizontal, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/utils/supabase/client";
import { toast } from "sonner";
import { User as SupabaseUser } from "@supabase/supabase-js";

interface FeedbackDialogProps {
  onOpenChangeAction: (open: boolean) => void;
  initialType?: FeedbackType;
}

type FeedbackType = "issue" | "idea" | "other";

export function FeedbackDialog({ onOpenChangeAction, initialType = "issue" }: FeedbackDialogProps) {
  const [selectedType, setSelectedType] = React.useState<FeedbackType>(initialType);
  const [email, setEmail] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [feedback, setFeedback] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [user, setUser] = React.useState<SupabaseUser | null>(null);
  const [profile, setProfile] = React.useState<{ full_name: string } | null>(null);

  const feedbackTypes = [
    {
      id: "issue" as FeedbackType,
      label: "Issue",
      icon: AlertTriangle,
      selectedColor: "bg-chart-6 hover:bg-chart-6/80 text-muted border-chart-6",
      defaultColor: "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border-border hover:border-muted-foreground/20",
    },
    {
      id: "idea" as FeedbackType,
      label: "Idea", 
      icon: Lightbulb,
      selectedColor: "bg-chart-4 hover:bg-chart-4/80 text-muted border-chart-4",
      defaultColor: "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border-border hover:border-muted-foreground/20",
    },
    {
      id: "other" as FeedbackType,
      label: "Other",
      icon: MoreHorizontal,
      selectedColor: "bg-chart-3 hover:bg-chart-3/80 text-muted border-chart-3",
      defaultColor: "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border-border hover:border-muted-foreground/20",
    },
  ];

  React.useEffect(() => {
    const getUser = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        setUser(user);
        setEmail(user.email || "");
        
        // Get profile info
        const { data: profileData } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .single();
        
        setProfile(profileData);
      }
    };

    getUser();
  }, []);

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

    if (feedback.length > 1000) {
      toast.error("Feedback too long", {
        description: "Feedback must be 1000 characters or less.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();
      
      const { error } = await supabase
        .from("feedback")
        .insert({
          user_id: user.id,
          section: selectedType,
          email: email.trim(),
          title: title.trim(),
          feedback: feedback.trim(),
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Feedback</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-6">
          <p className="text-sm text-muted-foreground">
            Have some feedback for Let&apos;s Assist? We would love to hear your thoughts!
          </p>
          
          {/* <p className="text-sm text-muted-foreground">
            This email will be used to contact you for further details on this feedback report{" "}
          </p> */}

          {user && profile && (
            <div className="bg-muted rounded-lg p-3 flex items-center space-x-2">
              <div className="w-2 h-2 bg-primary rounded-full"></div>
              <span className="text-sm text-muted-foreground">
                <strong>Note:</strong> You are logged in as {profile.full_name}
              </span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {feedbackTypes.map((type) => {
              const Icon = type.icon;
              const isSelected = selectedType === type.id;
              
              return (
                <button
                  key={type.id}
                  onClick={() => setSelectedType(type.id)}
                  className={cn(
                    "flex flex-col items-center justify-center p-4 rounded-lg ",
                    isSelected 
                      ? type.selectedColor
                      : type.defaultColor
                  )}
                >
                  <Icon className="w-6 h-6 mb-2" />
                  <span className="text-sm font-medium">{type.label}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="john@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="title" className="text-sm">
                Title
              </Label>
              <span className="text-xs text-muted-foreground">
                {title.length}/100
              </span>
            </div>
            <Input
              id="title"
              type="text"
              placeholder="Brief summary of your feedback"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 100))}
              className={title.length > 90 ? "border-yellow-500 focus:border-yellow-500" : ""}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="feedback" className="text-sm">
                Feedback
              </Label>
              <span className="text-xs text-muted-foreground">
                {feedback.length}/1000
              </span>
            </div>
            <Textarea
              id="feedback"
              placeholder="Describe the issue, what you were trying to do, and how the issue occurs"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value.slice(0, 1000))}
              className={`min-h-[100px] resize-none ${feedback.length > 950 ? "border-yellow-500 focus:border-yellow-500" : ""}`}
              rows={4}
            />
          </div>
        </div>
        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChangeAction(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!email.trim() || !title.trim() || !feedback.trim() || isSubmitting || title.length > 100 || feedback.length > 1000}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
