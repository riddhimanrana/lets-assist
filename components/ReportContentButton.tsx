"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Flag, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type ContentType = 'project' | 'profile' | 'comment' | 'image' | 'organization' | 'other';

type ReportReason = 
  | 'spam' 
  | 'harassment' 
  | 'inappropriate_content' 
  | 'misinformation' 
  | 'copyright' 
  | 'privacy_violation' 
  | 'violence' 
  | 'hate_speech' 
  | 'other';

interface ReportContentButtonProps {
  contentType: ContentType;
  contentId: string;
  triggerButton?: React.ReactNode;
}

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or Misleading' },
  { value: 'harassment', label: 'Harassment or Bullying' },
  { value: 'inappropriate_content', label: 'Inappropriate Content' },
  { value: 'misinformation', label: 'False Information' },
  { value: 'copyright', label: 'Copyright Violation' },
  { value: 'privacy_violation', label: 'Privacy Violation' },
  { value: 'violence', label: 'Violence or Threats' },
  { value: 'hate_speech', label: 'Hate Speech' },
  { value: 'other', label: 'Other' },
];

export function ReportContentButton({ contentType, contentId, triggerButton }: ReportContentButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!reason) {
      toast.error('Please select a reason for your report');
      return;
    }

    if (!description.trim()) {
      toast.error('Please provide a description');
      return;
    }

    if (description.trim().length < 10) {
      toast.error('Description must be at least 10 characters');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/report-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentType,
          contentId,
          reason,
          description: description.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit report');
      }

      toast.success('Report submitted successfully');
      toast.info('Our moderation team will review this content');
      
      // Reset form and close dialog
      setReason('');
      setDescription('');
      setOpen(false);
    } catch (error) {
      console.error('Error submitting report:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to submit report');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
            <Flag className="h-4 w-4 mr-2" />
            Report
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <DialogTitle>Report Content</DialogTitle>
          </div>
          <DialogDescription>
            Help us keep our community safe by reporting inappropriate content. Your report will be reviewed by our moderation team.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="reason">Reason for Report *</Label>
            <Select value={reason} onValueChange={(value) => setReason(value as ReportReason)}>
              <SelectTrigger id="reason">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              Description * <span className="text-muted-foreground text-xs">(minimum 10 characters)</span>
            </Label>
            <Textarea
              id="description"
              placeholder="Please provide specific details about why you're reporting this content..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={1000}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">
              {description.length}/1000
            </p>
          </div>

          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            <p className="font-medium mb-1">What happens next?</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Your report is submitted anonymously</li>
              <li>Our moderation team will review within 24-48 hours</li>
              <li>Appropriate action will be taken if violations are found</li>
              <li>You may receive a notification about the outcome</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !reason || !description.trim()}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Report'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
