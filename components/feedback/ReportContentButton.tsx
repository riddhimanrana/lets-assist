"use client";

import {
  cloneElement,
  isValidElement,
  MouseEvent,
  ReactElement,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
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

type TriggerElementProps = {
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onSelect?: (event: Event) => void;
};

interface ReportContentButtonProps {
  contentType: ContentType;
  contentId: string;
  /** Optional: title of the project or name of the profile being reported */
  contentTitle?: string;
  /** Optional: name of the content creator (for projects) or the profile owner */
  contentCreator?: string;
  /** Optional: additional context about the content (e.g., organization name) */
  contentContext?: string;
  triggerButton?: React.ReactNode;
  /** Controlled open state */
  open?: boolean;
  /** Callback for when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Whether to show the default trigger button if triggerButton is not provided */
  showTrigger?: boolean;
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

export function ReportContentButton({
  contentType,
  contentId,
  contentTitle,
  contentCreator,
  contentContext,
  triggerButton,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true
}: ReportContentButtonProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (newOpen: boolean) => {
    setInternalOpen(newOpen);
    onOpenChange?.(newOpen);
  };

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
          url: window.location.href,
          // Include rich metadata for better moderation context
          metadata: {
            title: contentTitle,
            creator: contentCreator,
            context: contentContext,
            reportedAt: new Date().toISOString(),
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit report');
      }

      toast.success('Report submitted successfully');

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

  const triggerElement = triggerButton || !showTrigger ? (
    isValidElement(triggerButton)
      ? (() => {
        const element = triggerButton as ReactElement<TriggerElementProps>;
        return cloneElement(element, {
          onClick: (event: MouseEvent<HTMLElement>) => {
            event.stopPropagation(); // Prevent dropdown from closing
            const previousOnClick = element.props.onClick;
            previousOnClick?.(event);
            if (event.defaultPrevented) {
              return;
            }
            setOpen(true);
          },
          onSelect: (event: Event) => {
            event.preventDefault(); // Prevent dropdown menu from closing
          },
        });
      })()
      : null
  ) : (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      onClick={(event) => {
        event.stopPropagation();
        setOpen(true);
      }}
    >
      <Flag className="h-4 w-4 mr-2" />
      Report
    </Button>
  );

  return (
    <>
      {triggerElement}
      <Dialog open={open} onOpenChange={setOpen}>
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
            <Field>
              <FieldLabel htmlFor="reason">Reason for Report *</FieldLabel>
              <Select value={reason} onValueChange={(value) => setReason(value as ReportReason)}>
                <SelectTrigger id="reason" className="w-full">
                  <SelectValue placeholder="Select a reason">
                    {reason ? REPORT_REASONS.find(r => r.value === reason)?.label : "Select a reason"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {REPORT_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="description">
                Description * <span className="text-muted-foreground text-xs">(minimum 10 characters)</span>
              </FieldLabel>
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
            </Field>

            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <p className="font-medium mb-1">What happens next?</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>Our moderation team will review in 1-2 weeks</li>
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
    </>
  );
}