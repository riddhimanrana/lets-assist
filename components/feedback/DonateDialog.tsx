"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, Mail, Copy, Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

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
      <DialogContent className="p-0 border-0 bg-transparent shadow-none sm:max-w-md">
        <DialogTitle className="sr-only">Support Let's Assist</DialogTitle>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Support Let's Assist</CardTitle>
            <CardDescription>
              We're on a mission to connect volunteers with impactful organizations. Your support helps keep our platform free and our community servers running.
            </CardDescription>
            <CardAction>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Heart className="h-5 w-5 fill-current" />
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="text-sm text-foreground/80 leading-relaxed bg-muted/50 p-3 rounded-lg border border-border/50">
              Scaling a platform for thousands of users comes with significant monthly costs. Your contribution, regardless of size, directly supports our infrastructure.
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Contact for donations
              </label>
              <div className="flex items-center gap-2 p-2 rounded-lg border bg-background shadow-xs">
                <Mail className="h-4 w-4 ml-2 text-muted-foreground shrink-0" />
                <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold flex-1 truncate">
                  {email}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyEmail}
                  className="h-8 shadow-none"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 mr-1 text-emerald-500" />
                      <span className="text-emerald-500">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Maybe Later
            </Button>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
