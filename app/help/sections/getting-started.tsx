"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, CheckCircle } from "lucide-react";
import Link from "next/link";

export function GettingStartedSection() {
  return (
    <div className="space-y-6">
      <Card id="getting-started-welcome">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Welcome to Let&apos;s Assist
          </CardTitle>
          <CardDescription>
            Your complete guide to tracking volunteer hours and managing projects
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="font-semibold">Quick Start</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-chart-5" />
                  Create your account and complete profile
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-chart-5" />
                  Browse or create your first project
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-chart-5" />
                  Start tracking your volunteer hours
                </li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="font-semibold">Key Features</h4>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Hour Tracking</Badge>
                <Badge variant="secondary">Project Management</Badge>
                <Badge variant="secondary">CSV Export</Badge>
                <Badge variant="secondary">Team Collaboration</Badge>
                <Badge variant="secondary">Certificates</Badge>
                <Badge variant="secondary">Organization Management</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="account-setup" id="getting-started-account">
          <AccordionTrigger>Setting Up Your Account</AccordionTrigger>
          <AccordionContent className="space-y-3">
            <p>Follow these steps to get your account ready:</p>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Complete your profile with your full name and contact information</li>
              <li>Upload a profile picture (optional but recommended)</li>
              <li>Set your time zone and notification preferences</li>
              <li>Connect with organizations you volunteer with</li>
            </ol>
            <Button asChild size="sm">
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="navigation" id="getting-started-navigation">
          <AccordionTrigger>Navigating the Platform</AccordionTrigger>
          <AccordionContent className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <h5 className="font-medium mb-2">Main Sections:</h5>
                <ul className="space-y-1">
                  <li><strong>Home:</strong> Your activity overview</li>
                  <li><strong>Dashboard:</strong> Hour tracking and stats</li>
                  <li><strong>Projects:</strong> Manage your volunteer projects</li>
                  <li><strong>Organizations:</strong> Connect with groups</li>
                  <li><strong>Certificates:</strong> View your achievements</li>
                </ul>
              </div>
              <div>
                <h5 className="font-medium mb-2">Quick Actions:</h5>
                <ul className="space-y-1">
                  <li>Use the + button to create new projects</li>
                  <li>Access settings from your profile menu</li>
                  <li>Export data from the dashboard</li>
                  <li>View certificates from your profile</li>
                </ul>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="first-steps" id="getting-started-first-steps">
          <AccordionTrigger>Your First Volunteer Project</AccordionTrigger>
          <AccordionContent className="space-y-3">
            <p>Ready to start tracking your volunteer work? Here&apos;s how:</p>
            <div className="space-y-3">
              <div className="p-3 bg-muted/50 rounded-lg">
                <h6 className="font-medium text-sm mb-1">Option 1: Join an Organization</h6>
                <p className="text-sm text-muted-foreground">Browse organizations and join projects with built-in verification</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <h6 className="font-medium text-sm mb-1">Option 2: Create Individual Project</h6>
                <p className="text-sm text-muted-foreground">Track personal volunteer work with manual hour entry</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <h6 className="font-medium text-sm mb-1">Option 3: Import Existing Hours</h6>
                <p className="text-sm text-muted-foreground">Upload a CSV file of your previous volunteer work</p>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
