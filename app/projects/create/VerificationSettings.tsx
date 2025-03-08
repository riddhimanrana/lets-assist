"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  QrCode,
  UserCheck,
  Clock,
  AlertTriangle,
  Info,
  Users,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VerificationMethod } from "@/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface VerificationSettingsProps {
  verificationMethod: VerificationMethod;
  requireLogin: boolean;
  updateVerificationMethodAction: (method: VerificationMethod) => void;
  updateRequireLoginAction: (requireLogin: boolean) => void;
}

export default function VerificationSettings({
  verificationMethod,
  requireLogin,
  updateVerificationMethodAction,
  updateRequireLoginAction,
}: VerificationSettingsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Volunteer Check-in Method
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Info className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs font-normal">
                  Choose how volunteers will check in and record their hours at
                  your event.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={verificationMethod}
            onValueChange={(value) =>
              updateVerificationMethodAction(value as VerificationMethod)
            }
            className="grid gap-4"
          >
            <label
              htmlFor="qr-code"
              className={cn(
              "flex flex-col items-start space-y-3 rounded-lg border p-4 hover:bg-accent cursor-pointer transition-colors",
              verificationMethod === "qr-code" && "border-primary bg-accent",
              )}
            >
              <div className="flex w-full justify-between space-x-3">
              <div className="flex items-center space-x-3">
                <RadioGroupItem value="qr-code" id="qr-code" />
                <div className="flex items-center space-x-2">
                <QrCode className="flex-shrink-0 h-5 w-5 text-primary mt-0.5" />
                <span className="font-medium">QR Code Self Check-in</span>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="pointer-events-none flex items-center h-6"
              >
                Recommended
              </Badge>
              </div>
              <div className="text-[0.9rem] text-muted-foreground ml-8">
              Volunteers scan QR code and log in to track their own hours.
              They can leave anytime, with automatic logout at the scheduled
              end time. Hours can be adjusted if needed.
              </div>
            </label>

            <label
              htmlFor="manual"
              className={cn(
                "flex flex-col items-start space-y-3 rounded-lg border p-4 hover:bg-accent cursor-pointer transition-colors",
                verificationMethod === "manual" && "border-primary bg-accent",
              )}
            >
              <div className="flex items-center space-x-3">
                <RadioGroupItem value="manual" id="manual" />
                <div className="flex items-center space-x-2">
                  <UserCheck className="flex-shrink-0 h-5 w-5 text-primary mt-0.5" />
                  <span className="font-medium">
                    Manual Check-in by Organizer
                  </span>
                </div>
              </div>
              <div className="text-[0.9rem] text-muted-foreground ml-8">
                You&apos;ll manually log each volunteer&apos;s attendance and
                hours. Most time-consuming for organizers but provides the
                highest level of verification.
              </div>
            </label>

            <label
              htmlFor="auto"
              className={cn(
                "flex flex-col items-start space-y-3 rounded-lg border p-4 hover:bg-accent cursor-pointer transition-colors",
                verificationMethod === "auto" && "border-primary bg-accent",
              )}
            >
              <div className="flex w-full justify-between space-x-3">
                <div className="flex items-center space-x-3">
                  <RadioGroupItem value="auto" id="auto" />
                  <div className="flex items-center space-x-2">
                    <Clock className="flex-shrink-0 h-5 w-5 text-primary mt-0.5" />
                    <span className="font-medium">Automatic Check-in/out</span>
                  </div>
                </div>
                <div className="flex items-center space-x-1">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <Badge
                    variant="secondary"
                    className="pointer-events-none text-yellow-500 bg-yellow-500/10"
                  >
                    Not Recommended
                  </Badge>
                </div>
              </div>
              <div className="text-[0.9rem] text-muted-foreground ml-8">
                System automatically logs attendance for the full scheduled
                time. Least accurate for attendance tracking.
              </div>
            </label>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Volunteer Sign-up Requirements
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Info className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs font-normal">
                  <p>
                    Control whether volunteers need to create an account to sign
                    up for your event.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="flex items-center justify-between space-x-4">
              <div className="flex items-center space-x-3">
                <div
                  className={cn(
                    "p-2 rounded-md",
                    requireLogin ? "bg-primary/10" : "bg-muted",
                  )}
                >
                  {requireLogin ? (
                    <Lock className="h-5 w-5 text-primary" />
                  ) : (
                    <Users className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <Label
                    htmlFor="require-login"
                    className="text-base font-medium"
                  >
                    Require account for sign-up
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {requireLogin
                      ? "Volunteers must create an account to sign up for your event"
                      : "Anyone can sign up without creating an account (anonymous volunteers)"}
                  </p>
                </div>
              </div>
              <Switch
                id="require-login"
                checked={requireLogin}
                onCheckedChange={updateRequireLoginAction}
              />
            </div>

            {!requireLogin && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 p-4 text-sm border border-amber-200 dark:border-amber-900">
                <div className="flex gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-800 dark:text-amber-500">
                      Anonymous sign-ups
                    </p>
                    <p className="text-amber-700 dark:text-amber-400 mt-1">
                      With anonymous sign-ups enabled, volunteers won&apos;t
                      need to create accounts. This may increase participation
                      but makes tracking and verification more challenging.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Button } from "@/components/ui/button";
