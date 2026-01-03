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
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  HelpCircle,
  CalendarIcon,
  CalendarClock,
  UsersRound,
  MapPin,
  Clock,
  Calendar,
  Users,
  Settings,
  Eye,
  Bell,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Project } from "@/types";
import { motion } from "framer-motion";

interface ProjectInstructionsModalProps {
  project: Project;
  isCreator?: boolean;
}

export default function ProjectInstructionsModal({ project, isCreator = false }: ProjectInstructionsModalProps) {
  const [open, setOpen] = useState(false);
  const { event_type, verification_method } = project;

  const getActiveTab = (): string => {
    if (isCreator) return 'overview';
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

  const renderProjectTypeInstructions = () => {
    switch (event_type) {
      case 'oneTime':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">One-Time Event</Badge>
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

  const renderCreatorInstructions = () => {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">Managing Your Project</h3>
          <p className="text-muted-foreground">
            Here&apos;s how to effectively run your {event_type === "oneTime" ? "one-time event" : 
                         event_type === "multiDay" ? "multi-day event" : 
                         "multi-role event"} with {verification_method} verification.
          </p>
        </div>

        <div className="grid gap-4">
          {/* Project Setup */}
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Project Setup Complete
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>Your project is live and accepting volunteers</p>
              <p>Event type: {event_type === "oneTime" ? "One-time event" : 
                         event_type === "multiDay" ? "Multi-day event" : 
                         "Multi-role event"}</p>
              <p>Verification: {verification_method === 'qr-code' ? "QR Code check-in" :
                                   verification_method === 'manual' ? "Manual check-in" :
                                   verification_method === 'auto' ? "Automatic check-in" :
                                   "Sign-up only"}</p>
            </CardContent>
          </Card>

          {/* Volunteer Management */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-5 w-5" />
                Managing Volunteers
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <div className="space-y-2">
                <p className="font-medium">Before the Event:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Monitor signups from the &quot;Manage Signups&quot; page</li>
                  <li>Review volunteer information and approve/reject as needed</li>
                  <li>Download signup lists and contact information</li>
                  {verification_method === 'qr-code' && (
                    <li>Print QR codes 24 hours before the event starts</li>
                  )}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Event Day */}
          {verification_method !== 'signup-only' && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  During the Event
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                {verification_method === 'qr-code' && (
                  <div className="space-y-2">
                    <p className="font-medium">QR Code Check-in:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Display QR codes at the check-in location</li>
                      <li>Have volunteers scan to check in when they arrive</li>
                      <li>Have them scan again when they leave</li>
                      <li>Monitor attendance from the &quot;Manage Attendance&quot; page</li>
                    </ul>
                  </div>
                )}
                {verification_method === 'manual' && (
                  <div className="space-y-2">
                    <p className="font-medium">Manual Check-in:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Use the &quot;Check-in Volunteers&quot; page to mark attendance</li>
                      <li>Record arrival and departure times manually</li>
                      <li>Update volunteer status as they participate</li>
                    </ul>
                  </div>
                )}
                {verification_method === 'auto' && (
                  <div className="space-y-2">
                    <p className="font-medium">Automatic Tracking:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Hours are automatically calculated based on your schedule</li>
                      <li>Monitor the &quot;Manage Attendance&quot; page for overview</li>
                      <li>No manual check-in required</li>
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* After Event */}
          {verification_method !== 'auto' && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  After the Event
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div className="space-y-2">
                  <p className="font-medium">Managing Volunteer Hours:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Review and edit volunteer hours within 48 hours</li>
                    <li>Publish hours to generate certificates</li>
                    <li>Hours auto-publish after 48 hours if not manually published</li>
                    <li>Volunteers receive their certificates automatically</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notifications */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Communication
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>Volunteers with accounts will receive notifications for:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Signup confirmations and rejections</li>
                <li>Project updates and cancellations</li>
                <li>Hour publishing and certificate availability</li>
              </ul>
              <p className="text-muted-foreground mt-2">
                Anonymous volunteers only receive email confirmations.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={"outline"}
          size={isCreator ? "default": "sm"}
          className={`gap-2 `}
        >
          <HelpCircle className="h-4 w-4" />
          {isCreator ? "Creator Guide" : "How It Works"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] p-0 max-h-[90vh]">
        <DialogHeader className="p-6 pb-2 flex flex-row items-center gap-2">
          <div className={`p-2 rounded-full ${isCreator ? "bg-chart-6/20" : "bg-primary/10"}`}>
            {isCreator ? <Settings className="h-5 w-5 text-chart-6" /> : getProjectTypeIcon()}
          </div>
          <DialogTitle className="text-xl">
            {isCreator ? "Creator Guide" : "How It Works"}
          </DialogTitle>
        </DialogHeader>
        
        {/* <div className="px-6 pb-2">
          <p className="text-muted-foreground">
            {isCreator 
              ? "Learn how to manage your project and volunteers effectively"
              : `Learn how this ${event_type === "oneTime" ? "one-time event" : 
                         event_type === "multiDay" ? "multi-day event" : 
                         "multi-role event"} works and how to participate.`}
          </p>
        </div> */}
        
        <ScrollArea className="max-h-[70vh]">
          <div className="px-6 pb-6">
            {isCreator ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                {renderCreatorInstructions()}
              </motion.div>
            ) : (
              <Tabs defaultValue={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid grid-cols-3 mb-4">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="signup">Sign Up</TabsTrigger>
                  <TabsTrigger value="check-in">
                    {verification_method === 'signup-only' ? 'Attending' : 'Check-In'}
                  </TabsTrigger>
                </TabsList>
                
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
                    {renderCreatorInstructions()}
                  </motion.div>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
