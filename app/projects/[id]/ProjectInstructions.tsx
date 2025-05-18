"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  HelpCircle,
  CalendarIcon,
  CalendarClock,
  UsersRound,
  ClipboardCheck,
  CheckCircle,
  UserCheck,
  QrCode,
  MapPin,
  Clock,
  Calendar,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Project, EventType, VerificationMethod } from "@/types";
import { motion } from "framer-motion";

interface ProjectInstructionsModalProps {
  project: Project;
}

export default function ProjectInstructionsModal({ project }: ProjectInstructionsModalProps) {
  const [open, setOpen] = useState(false);
  const { event_type, verification_method } = project;

  const getActiveTab = (): string => {
    // Default active tab based on project type
    if (verification_method === 'qr-code') return 'check-in';
    if (verification_method === 'signup-only') return 'signup';
    return 'overview';
  };
  
  const [activeTab, setActiveTab] = useState<string>(getActiveTab());

  const getProjectTypeIcon = () => {
    switch (event_type) {
      case 'oneTime':
        return <CalendarIcon className="h-5 w-5" />;
      case 'multiDay':
        return <CalendarClock className="h-5 w-5" />;
      case 'sameDayMultiArea':
        return <UsersRound className="h-5 w-5" />;
      default:
        return <HelpCircle className="h-5 w-5" />;
    }
  };

  const getVerificationMethodIcon = () => {
    switch (verification_method) {
      case 'qr-code':
        return <QrCode className="h-5 w-5" />;
      case 'manual':
        return <ClipboardCheck className="h-5 w-5" />;
      case 'auto':
        return <CheckCircle className="h-5 w-5" />;
      case 'signup-only':
        return <UserCheck className="h-5 w-5" />;
      default:
        return <HelpCircle className="h-5 w-5" />;
    }
  };

  const renderProjectTypeInstructions = () => {
    switch (event_type) {
      case 'oneTime':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-primary/20 text-primary border-primary/30">One-Time Event</Badge>
            </div>
            <p>This is a single event that happens on one specific date and time.</p>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> 
                  Event Date & Time
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>All volunteers participate during the same time period.</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4" /> 
                  Single Location
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>All volunteers report to the same location for this event.</p>
              </CardContent>
            </Card>
          </div>
        );

      case 'multiDay':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-primary/20 text-primary border-primary/30">Multi-Day Event</Badge>
            </div>
            <p>This event spans multiple days with different time slots.</p>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarClock className="h-4 w-4" /> 
                  Multiple Sessions
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>This event has sessions across different days and times.</p>
                <p className="mt-2">You may sign up for one or more sessions based on your availability.</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" /> 
                  Flexible Scheduling
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>Each day may have different time slots available.</p>
              </CardContent>
            </Card>
          </div>
        );

      case 'sameDayMultiArea':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-primary/20 text-primary border-primary/30">Multi-Role Event</Badge>
            </div>
            <p>This event happens on a single day with multiple roles for volunteers.</p>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <UsersRound className="h-4 w-4" /> 
                  Different Roles
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>Different volunteer roles may have different responsibilities, locations, or time commitments.</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> 
                  Single Day
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>All roles take place on the same day, but may have different start and end times.</p>
              </CardContent>
            </Card>
          </div>
        );

      default:
        return <p>No specific instructions available for this project type.</p>;
    }
  };

  const renderVerificationInstructions = () => {
    switch (verification_method) {
      case 'qr-code':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-indigo-500/20 text-indigo-500 border-indigo-500/30">QR Code Check-In</Badge>
            </div>
            <p>This event uses QR codes for volunteer check-in and check-out.</p>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <QrCode className="h-4 w-4" /> 
                  How to Check In
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p>1. Arrive at the event location.</p>
                <p>2. Find the event coordinator with the QR code.</p>
                <p>3. Open the app and tap on &quot;Scan QR Code&quot; in your dashboard.</p>
                <p>4. Scan the QR code to check in.</p>
                <p className="text-muted-foreground mt-2">* QR codes become available 2 hours before each session starts.</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" /> 
                  Checking Out
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>When your shift is completed, scan the QR code again to check out and record your volunteer hours.</p>
              </CardContent>
            </Card>
          </div>
        );

      case 'manual':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30">Manual Verification</Badge>
            </div>
            <p>This event uses manual verification by the event coordinator.</p>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4" /> 
                  Attendance Process
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p>1. Arrive at the event and check in with the coordinator.</p>
                <p>2. The coordinator will manually mark your attendance.</p>
                <p>3. When leaving, inform the coordinator to record your end time.</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" /> 
                  Hours Verification
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>The event coordinator will verify and publish your volunteer hours after the event.</p>
              </CardContent>
            </Card>
          </div>
        );

      case 'auto':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">Automatic Verification</Badge>
            </div>
            <p>This event automatically tracks your volunteer hours.</p>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" /> 
                  Automated Process
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p>1. Hours are automatically calculated based on the event schedule.</p>
                <p>2. Your attendance is automatically verified.</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" /> 
                  Hours Crediting
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>Your volunteer hours will be automatically credited once the event is complete.</p>
              </CardContent>
            </Card>
          </div>
        );

      case 'signup-only':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30">Signup Only</Badge>
            </div>
            <p>This is a signup-only event where no hour tracking is required.</p>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <UserCheck className="h-4 w-4" /> 
                  Simple Registration
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>Just register for the event and show up! No need to check in or out.</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" /> 
                  Attendance
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>Your participation will be recognized, but specific hours won&apos;t be tracked for this event.</p>
              </CardContent>
            </Card>
          </div>
        );

      default:
        return <p>No specific instructions available for this verification method.</p>;
    }
  };

  const renderSignupInstructions = () => {
    return (
      <div className="space-y-4">
        <h3 className="font-medium">How to Sign Up</h3>
        <p>Follow these steps to sign up for this volunteer opportunity:</p>
        
        <div className="space-y-2">
          <div className="rounded-lg bg-primary/5 border p-4">
            <div className="flex items-start gap-3">
              <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">1</div>
              <div>
                <p className="font-medium">Review Project Details</p>
                <p className="text-sm text-muted-foreground mt-1">Read through all project information and requirements.</p>
              </div>
            </div>
          </div>
          
          <div className="rounded-lg bg-primary/5 border p-4">
            <div className="flex items-start gap-3">
              <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">2</div>
              <div>
                <p className="font-medium">Select Available Slot</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {event_type === "oneTime" 
                    ? "Confirm you're available for the scheduled date and time." 
                    : event_type === "multiDay" 
                    ? "Choose which day and time slot works best for you." 
                    : "Select which role you'd like to volunteer for."}
                </p>
              </div>
            </div>
          </div>
          
          <div className="rounded-lg bg-primary/5 border p-4">
            <div className="flex items-start gap-3">
              <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">3</div>
              <div>
                <p className="font-medium">Click the &quot;Sign Up&quot; Button</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Complete the signup process by clicking the sign up button for your preferred slot.
                </p>
              </div>
            </div>
          </div>

          {verification_method !== "signup-only" && (
            <div className="rounded-lg bg-primary/5 border p-4">
              <div className="flex items-start gap-3">
                <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">4</div>
                <div>
                  <p className="font-medium">Check In on Event Day</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {verification_method === "qr-code" 
                      ? "Scan the QR code when you arrive and leave."
                      : verification_method === "manual"
                      ? "Check in with the event coordinator upon arrival."
                      : "Your hours will be tracked automatically."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 hover:bg-primary/5"
        >
          <HelpCircle className="h-4 w-4" />
          How It Works
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] p-0">
        <DialogHeader className="p-6 pb-2 flex flex-row items-center gap-2">
          <div className="bg-primary/10 p-2 rounded-full">
            {getProjectTypeIcon()}
          </div>
          <DialogTitle className="text-xl">Project Instructions</DialogTitle>
        </DialogHeader>
        
        <div className="px-6 pb-2">
          <p className="text-muted-foreground">
            Learn how this {event_type === "oneTime" ? "one-time event" : 
                         event_type === "multiDay" ? "multi-day event" : 
                         "multi-role event"} works and how to participate.
          </p>
        </div>
        
        <Tabs defaultValue={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="px-6">
            <TabsList className="grid grid-cols-3 mb-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="signup">Signup</TabsTrigger>
              <TabsTrigger value="check-in">
                {verification_method === 'signup-only' ? 'Attendance' : 'Check-In'}
              </TabsTrigger>
            </TabsList>
          </div>
          
          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 pb-6">
              <TabsContent value="overview" className="mt-0 pt-4">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {renderProjectTypeInstructions()}
                </motion.div>
              </TabsContent>
              
              <TabsContent value="signup" className="mt-0 pt-4">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {renderSignupInstructions()}
                </motion.div>
              </TabsContent>
              
              <TabsContent value="check-in" className="mt-0 pt-4">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {renderVerificationInstructions()}
                </motion.div>
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}