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
  Clipboard,
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
  isOrganization: boolean; // Add this to detect if creating for an organization
  isPrivate: boolean; // Add this for project visibility
  updateVerificationMethodAction: (method: VerificationMethod) => void;
  updateRequireLoginAction: (requireLogin: boolean) => void;

  updateIsPrivateAction: (isPrivate: boolean) => void; // Add this action
  restrictToOrgDomains?: boolean;
  updateRestrictToOrgDomainsAction?: (restrict: boolean) => void;
  allowedEmailDomains?: string[] | null;
  errors?: {
    verificationMethod?: string;
    requireLogin?: string;
    isPrivate?: string;
  };
}

export default function VerificationSettings({
  verificationMethod,
  requireLogin,
  isOrganization,
  isPrivate,
  updateVerificationMethodAction,
  updateRequireLoginAction,

  updateIsPrivateAction,
  restrictToOrgDomains = false,
  updateRestrictToOrgDomainsAction,
  allowedEmailDomains,
  errors = {},
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
                errors.verificationMethod && "border-destructive",
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
                errors.verificationMethod && "border-destructive",
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
                errors.verificationMethod && "border-destructive",
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
                  <AlertTriangle className="h-4 w-4 text-chart-4" />
                  <Badge
                    variant="secondary"
                    className="pointer-events-none text-chart-4 bg-chart-4/10"
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

            {/* Add the new signup-only option */}
            <label
              htmlFor="signup-only"
              className={cn(
                "flex flex-col items-start space-y-3 rounded-lg border p-4 hover:bg-accent cursor-pointer transition-colors",
                verificationMethod === "signup-only" && "border-primary bg-accent",
                errors.verificationMethod && "border-destructive",
              )}
            >
              <div className="flex items-center space-x-3">
                <RadioGroupItem value="signup-only" id="signup-only" />
                <div className="flex items-center space-x-2">
                  <Clipboard className="flex-shrink-0 h-5 w-5 text-primary mt-0.5" />
                  <span className="font-medium">
                    Sign-up Only (No Hour Tracking)
                  </span>
                </div>
              </div>
              <div className="text-[0.9rem] text-muted-foreground ml-8">
                Simplest option that only collects volunteer signups without tracking hours.
                Perfect for events where you just need a headcount or when attendance is tracked separately.
              </div>
            </label>
          </RadioGroup>

          {errors.verificationMethod && (
            <div className="text-destructive text-sm flex items-center gap-2 mt-4">
              <AlertTriangle className="h-4 w-4" />
              {errors.verificationMethod}
            </div>
          )}
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
                    errors.requireLogin && "border border-destructive",
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

            {errors.requireLogin && (
              <div className="text-destructive text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {errors.requireLogin}
              </div>
            )}

            {!requireLogin && (
              <div className="rounded-lg bg-chart-6/10 p-4 text-sm border border-chart-6/40">
                <div className="flex gap-2">
                  <AlertTriangle className="h-5 w-5 text-chart-6 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-chart-6">Anonymous sign-ups</p>
                    <p className="text-chart-4 mt-1">
                      With anonymous sign-ups enabled, volunteers won&apos;t need to create
                      accounts. This may increase participation but makes tracking and
                      verification more challenging.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Only show visibility toggle when creating for an organization */}
      {isOrganization && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Project Visibility
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <Info className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs font-normal">
                    <p>
                      Control who can view this project. Public projects are visible to everyone,
                      while private projects are only visible to organization members.
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
                      isPrivate ? "bg-primary/10" : "bg-muted",
                      errors.isPrivate && "border border-destructive",
                    )}
                  >
                    {isPrivate ? (
                      <Lock className="h-5 w-5 text-primary" />
                    ) : (
                      <Users className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <Label
                      htmlFor="is-private"
                      className="text-base font-medium"
                    >
                      {isPrivate ? "Private project" : "Public project"}
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      {isPrivate
                        ? "Only organization members can view this project"
                        : "Everyone can view this project"}
                    </p>
                  </div>
                </div>
                <Switch
                  id="is-private"
                  checked={isPrivate}
                  onCheckedChange={updateIsPrivateAction}
                />
              </div>

              {errors.isPrivate && (
                <div className="text-destructive text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {errors.isPrivate}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Domain Restriction Toggle - Only show if organization has allowed domains */}
      {isOrganization && allowedEmailDomains && allowedEmailDomains.length > 0 && updateRestrictToOrgDomainsAction && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Domain Restrictions
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <Info className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs font-normal">
                    <p>
                      Restrict signups to users with specific email domains.
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
                      restrictToOrgDomains ? "bg-primary/10" : "bg-muted",
                    )}
                  >
                    {restrictToOrgDomains ? (
                      <Lock className="h-5 w-5 text-primary" />
                    ) : (
                      <Users className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <Label
                      htmlFor="restrict-domains"
                      className="text-base font-medium"
                    >
                      Restrict to Organization Domains
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      {restrictToOrgDomains
                        ? `Only users with emails from: ${allowedEmailDomains.join(", ")} can sign up.`
                        : "Users with any email domain can sign up."}
                    </p>
                  </div>
                </div>
                <Switch
                  id="restrict-domains"
                  checked={restrictToOrgDomains}
                  onCheckedChange={updateRestrictToOrgDomainsAction}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { Button } from "@/components/ui/button";
