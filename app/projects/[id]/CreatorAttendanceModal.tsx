// filepath: /Users/riddhiman.rana/Desktop/Coding/lets-assist/app/projects/[id]/CreatorAttendanceModal.tsx
"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, CheckCircle, Clock, Loader2, Mail, Search, UserCheck } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { createClient } from "@/utils/supabase/client";
import { checkInParticipant } from "@/app/projects/[id]/actions"; // Keep this path as it's relative to the app root

interface Participant {
  id: string;
  user_id: string | null;
  email: string;
  phone_number?: string | null;
  name: string;
  schedule_id: string;
  check_in_time: string | null;
  is_anonymous: boolean;
}

interface CreatorAttendanceModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreatorAttendanceModal({ 
  projectId, 
  open, 
  onOpenChange 
}: CreatorAttendanceModalProps) {
  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [filteredParticipants, setFilteredParticipants] = useState<Participant[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [processingIds, setProcessingIds] = useState<string[]>([]);

  // Fetch participants when modal opens
  useEffect(() => {
    if (open) {
      fetchParticipants();
    }
  }, [open, projectId]);

  // Filter participants based on search and tab
  useEffect(() => {
    if (!participants.length) {
      setFilteredParticipants([]);
      return;
    }

    let filtered = [...participants];
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(query) || 
        p.email.toLowerCase().includes(query)
      );
    }
    
    // Apply tab filter
    if (activeTab === "checked-in") {
      filtered = filtered.filter(p => p.check_in_time);
    } else if (activeTab === "not-checked-in") {
      filtered = filtered.filter(p => !p.check_in_time);
    }
    
    setFilteredParticipants(filtered);
  }, [participants, searchQuery, activeTab]);

  // Fetch all approved participants
  const fetchParticipants = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      
      // Get all approved signups for this project
      const { data: signups, error: signupsError } = await supabase
        .from("project_signups")
        .select("id, user_id, schedule_id, check_in_time, status")
        .eq("project_id", projectId)
        .in("status", ["approved", "attended"]);

        
      if (signupsError) throw signupsError;
      
      // Get profile info for registered users
      const userIds = signups.filter(s => s.user_id).map(s => s.user_id);
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);
        
      if (profilesError) throw profilesError;
      
      // Get anonymous users
      const signupIds = signups.filter(s => !s.user_id).map(s => s.id);
      const { data: anonSignups, error: anonError } = await supabase
        .from("anonymous_signups")
        .select("id, email, signup_id, name, phone_number")
        .in("signup_id", signupIds);
        
      if (anonError) throw anonError;
      
      // Combine the data
      const formattedParticipants: Participant[] = signups.map(signup => {
        if (signup.user_id) {
          // Registered user
          const profile = profiles.find(p => p.id === signup.user_id);
          return {
            id: signup.id,
            user_id: signup.user_id,
            email: profile?.email || "Unknown email",
            name: profile ? `${profile.full_name}` : "Unknown user",
            schedule_id: signup.schedule_id,
            check_in_time: signup.check_in_time,
            is_anonymous: false
          };
        } else {
          // Anonymous user
          const anonSignup = anonSignups.find(a => a.signup_id === signup.id);
          console.log(anonSignup);
          return {
            id: signup.id,
            user_id: null,
            email: anonSignup?.email || "Unknown email",
            name: anonSignup?.name || "Anonymous Volunteer",
            phone_number: anonSignup?.phone_number || null,
            schedule_id: signup.schedule_id,
            check_in_time: signup.check_in_time,
            is_anonymous: true
          };
        }
      });
      
      setParticipants(formattedParticipants);
    } catch (error) {
      console.error("Error fetching participants:", error);
      toast.error("Failed to load participants");
    } finally {
      setLoading(false);
    }
  };

  // Handle manual check-in
  const handleCheckIn = async (participantId: string) => {
    setProcessingIds(prev => [...prev, participantId]);
    
    try {
      const result = await checkInParticipant(participantId);
      
      if (result.success) {
        toast.success("Participant checked in successfully");
        
        // Update local state
        setParticipants(prev => 
          prev.map(p => p.id === participantId 
            ? { ...p, check_in_time: new Date().toISOString() } 
            : p
          )
        );
      } else {
        toast.error(result.error || "Failed to check in participant");
      }
    } catch (error) {
      console.error("Error checking in participant:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setProcessingIds(prev => prev.filter(id => id !== participantId));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            Manage Attendance
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Search and filters */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search participants..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="checked-in">Checked In</TabsTrigger>
                <TabsTrigger value="not-checked-in">Not Checked In</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          
          {/* Participants table */}
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredParticipants.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center">
                        {participants.length === 0 
                          ? "No participants found for this project" 
                          : "No participants match your filters"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredParticipants.map((participant) => (
                      <TableRow key={participant.id}>
                        <TableCell className="font-medium">
                          {participant.name}
                          {participant.is_anonymous && (
                            <Badge className="ml-2 px-2 py-0.5 text-xs rounded-full" variant="secondary">
                              Anonymous
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                            <div className="flex flex-col gap-0.5">
                            <span>{participant.email}</span>
                            {participant.is_anonymous && participant.phone_number && (
                                <span className="text-xs text-muted-foreground">
                                {participant.phone_number.replace(
                                  /^(\d{3})(\d{3})(\d{4})$/,
                                  "$1-$2-$3"
                                )}
                                </span>
                            )}
                            </div>
                        </TableCell>
                        <TableCell>{participant.schedule_id}</TableCell>
                        <TableCell>
                          {participant.check_in_time ? (
                            <div className="flex items-center gap-1 text-chart-5">
                              <CheckCircle className="h-4 w-4" />
                              <span>
                                Checked in at {format(new Date(participant.check_in_time), "h:mm a")}
                              </span>
                            </div>
                          ) : (
                            <span className="text-amber-600">Not checked in</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {!participant.check_in_time && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCheckIn(participant.id)}
                              disabled={processingIds.includes(participant.id)}
                            >
                              {processingIds.includes(participant.id) ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                  Processing...
                                </>
                              ) : (
                                <>
                                  <Check className="h-3.5 w-3.5 mr-1.5" />
                                  Check In
                                </>
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
