"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, Mail, Copy, Check, Info } from "lucide-react";
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
      <DialogContent className="p-0 border-0 bg-transparent shadow-none sm:max-w-md">
        <DialogTitle className="sr-only">Support Let's Assist</DialogTitle>
        <Card className="w-full border-border shadow-2xl relative overflow-hidden gap-0">


          <CardHeader className="relative z-10 pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Heart className="h-5 w-5 fill-current" />
              </div>
              <CardTitle className="text-xl">Support Let's Assist</CardTitle>
            </div>
            <CardDescription className="text-base text-foreground/80 leading-relaxed">
              We&apos;re on a mission to connect volunteers with impactful organizations. Your support helps keep our platform free and our community servers running.
            </CardDescription>
          </CardHeader>

          <CardContent className="relative z-10 space-y-4 pb-0">
            <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground leading-relaxed border border-border/50">
              <p className="flex gap-2">
                <Info className="h-4 w-4 shrink-0 translate-y-0.5 text-primary" />
                <span>
                  Scaling a platform for thousands of users comes with significant monthly costs. Your contribution, regardless of size, directly supports our infrastructure.
                </span>
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Contact for donations:
              </p>
              <div className="flex items-center gap-3 p-2.5 pl-4 pr-2 rounded-xl border bg-background/50 shadow-sm ring-offset-background transition-all focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-sm font-mono truncate">{email}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={copyEmail}
                  className="h-9 px-4 shadow-none rounded-lg"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 mr-1.5 text-emerald-500" />
                      <span className="text-emerald-500 font-medium">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 mr-1.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>

          <CardFooter className="p-2 relative z-10">
            <Button
              className="w-full text-muted-foreground hover:text-foreground"
              variant="ghost"
              size="sm"
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
