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
          {/* Decorative background element */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-[100px] pointer-events-none" />

          <CardHeader className="relative z-10 pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Heart className="h-5 w-5 fill-current" />
              </div>
              <CardTitle className="text-xl">Support Let's Assist</CardTitle>
            </div>
            <CardDescription className="text-base text-foreground/80">
              Your support keeps our community servers running and helps us connect more volunteers with organizations.
            </CardDescription>
          </CardHeader>

          <CardContent className="relative z-10 space-y-4">
            <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground leading-relaxed border border-border/50">
              <p className="flex gap-2">
                <Info className="h-4 w-4 shrink-0 translate-y-0.5 text-primary" />
                <span>
                  Running a platform for thousands of users costs hundreds of dollars monthly. Every donation, no matter the size, makes a difference.
                </span>
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Contact for donations:
              </p>
              <div className="flex items-center gap-2 p-1.5 pl-3 pr-1.5 rounded-lg border bg-background shadow-sm ring-offset-background transition-all focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-sm font-mono truncate">{email}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={copyEmail}
                  className="h-8 shadow-none"
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

          <CardFooter className="bg-muted/30 pt-4 relative z-10">
            <Button className="w-full" variant="outline" onClick={() => onOpenChange(false)}>
              Maybe Later
            </Button>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
