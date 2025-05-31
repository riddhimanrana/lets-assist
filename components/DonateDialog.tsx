"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Heart, Mail, Copy, Check } from "lucide-react";
import { useState } from "react";

interface DonateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DonateDialog({ open, onOpenChange }: DonateDialogProps) {
  const [copied, setCopied] = useState(false);
  const email = "riddhiman.rana@gmail.com";

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy email:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-chart-1" />
            Support Let&apos;s Assist
          </DialogTitle>
          <DialogDescription className="text-left space-y-3 pt-2">
            <p>
              It costs hundreds of dollars to run our servers every month to keep Let&apos;s Assist running smoothly for all our volunteers and organizations.
            </p>
            <p>
              Every donation, no matter how small, helps us continue connecting communities and making volunteering easier for everyone.
            </p>
            <p className="font-medium">
              If you&apos;d like to support our mission, please contact me at:
            </p>
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex items-center space-x-2 p-3 bg-muted rounded-lg">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-sm font-mono">{email}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={copyEmail}
            className="h-8"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 mr-1" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </>
            )}
          </Button>
        </div>
        
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
