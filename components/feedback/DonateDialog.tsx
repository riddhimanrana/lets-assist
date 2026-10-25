"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Mail, Copy, Check } from "lucide-react";
import { useState } from "react";
import { copyToClipboard } from "@/lib/utils";

interface DonateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DonateDialog({ open, onOpenChange }: DonateDialogProps) {
  const [copied, setCopied] = useState(false);
  const email = "support@letsassist.org";

  const copyEmail = async () => {
    const success = await copyToClipboard(email);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Support Let&apos;s Assist</DialogTitle>
          <DialogDescription>
            I&apos;m on a mission to connect volunteers with impactful
            organizations. Your support helps keep our platform free and our
            community servers running.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <p className="text-muted-foreground text-sm">
            Scaling a platform for thousands of users comes with significant
            monthly costs. Your contribution, regardless of size, directly
            supports our infrastructure.
          </p>
          <Field>
            <FieldLabel htmlFor="donation-email">
              Contact for donations
            </FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <Mail aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                id="donation-email"
                value={email}
                readOnly
                className="font-mono"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="sm" onClick={copyEmail}>
                  {copied ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
