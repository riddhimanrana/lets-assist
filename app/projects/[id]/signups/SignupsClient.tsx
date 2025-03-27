"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { Project, EventType } from "@/types";
import { createRejectionNotification } from "../actions";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, ArrowLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Props {
  projectId: string;
}

type Signup = {
  id: string;
  created_at: string;
  status: "pending" | "cancelled";
  user_id: string | null;
  anonymous_name: string | null;
  anonymous_email: string | null;
  anonymous_phone: string | null;
  schedule_id: string;
  profile?: {
    full_name: string;
    username: string;
  };
};

export function SignupsClient({ projectId }: Props): React.JSX.Element {
  const router = useRouter();
  const [signups, setSignups] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingSignups, setProcessingSignups] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [project, setProject] = useState<Project | null>(null);

  // Group signups by schedule slot
  const signupsBySlot = useMemo(() => {
    return signups.reduce((acc, signup) => {
      if (!acc[signup.schedule_id]) {
        acc[signup.schedule_id] = [];
      }
      acc[signup.schedule_id].push(signup);
      return acc;
    }, {} as Record<string, Signup[]>);
  }, [signups]);

  // Filter signups based on search term
  const filteredSignupsBySlot = useMemo(() => {
    if (!searchTerm) return signupsBySlot;

    const searchLower = searchTerm.toLowerCase();
    const filtered: Record<string, Signup[]> = {};

    Object.entries(signupsBySlot).forEach(([slot, slotSignups]) => {
      filtered[slot] = slotSignups.filter(signup => {
        const nameMatch = signup.user_id
          ? signup.profile?.full_name.toLowerCase().includes(searchLower)
          : signup.anonymous_name?.toLowerCase().includes(searchLower);
        return nameMatch;
      });
    });

    return filtered;
  }, [signupsBySlot, searchTerm]);

  useEffect(() => {
    loadProject();
    loadSignups();
  }, [projectId]);

  const loadProject = async () => {
    const supabase = createClient();
    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (error) {
      console.error("Error loading project:", error);
      return;
    }

    setProject(project as Project);
  };

  const loadSignups = async () => {
    const supabase = createClient();
    
    const { data, error } = await supabase
      .from("project_signups")
      .select(`
        id,
        created_at,
        status,
        user_id,
        anonymous_name,
        anonymous_email,
        anonymous_phone,
        schedule_id,
        profile:profiles!left (
          full_name,
          username
        )
      `)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading signups:", error);
      toast.error("Failed to load signups");
      return;
    }

    setSignups(data as unknown as Signup[]);
    setLoading(false);
  };

  const updateSignupStatus = async (signupId: string, status: "cancelled") => {
    try {
      setProcessingSignups(prev => ({ ...prev, [signupId]: true }));
      const supabase = createClient();
      
      // Get the signup details first
      const { data: signup } = await supabase
        .from("project_signups")
        .select("user_id, project_id")
        .eq("id", signupId)
        .single();

      if (!signup) {
        throw new Error("Failed to get signup details");
      }

      // Update the signup status
      const { error: updateError } = await supabase
        .from("project_signups")
        .update({ status })
        .eq("id", signupId);

      if (updateError) {
        throw new Error("Failed to update signup status");
      }

      // Send notification if user is registered
      if (signup.user_id) {
        const result = await createRejectionNotification(
          signup.user_id,
          projectId,
          signupId
        );
        
        if (result.error) {
          console.error("Error sending notification:", result.error);
        }
      }

      // Refresh the signups list
      await loadSignups();
      toast.success("Signup rejected successfully");
    } catch (error) {
      console.error("Error updating signup:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update signup");
    } finally {
      setProcessingSignups(prev => ({ ...prev, [signupId]: false }));
    }
  };

  const formatScheduleSlot = (project: Project, slotId: string) => {
    if (!project) return slotId;

    if (project.event_type === "oneTime") {
      const slot = project.schedule.oneTime;
      if (!slot) return slotId;
      return `One-time Event on ${format(new Date(slot.date), "MMMM d, yyyy")} at ${slot.startTime}`;
    }

    if (project.event_type === "multiDay") {
      const [date, slotIndex] = slotId.split("-");
      const day = project.schedule.multiDay?.find(d => d.date === date);
      const slot = day?.slots[parseInt(slotIndex)];
      if (slot) {
        return `${format(new Date(date), "MMMM d, yyyy")} at ${slot.startTime}`;
      }
    }

    if (project.event_type === "sameDayMultiArea") {
      const role = project.schedule.sameDayMultiArea?.roles.find(r => r.name === slotId);
      if (role) {
        return `Role: ${role.name}`;
      }
    }

    return slotId;
  };

  const getStatusBadge = (status: string) => {
    if (status === "cancelled") {
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Rejected
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" />
        Pending
      </Badge>
    );
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="mb-6">
        <Button
          variant="ghost"
          className="gap-2"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Project
        </Button>
      </div>

      <Card className="min-h-[400px] relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading signups...</span>
            </div>
          </div>
        )}
        <CardHeader>
          <CardTitle>Manage Volunteer Signups</CardTitle>
          <CardDescription>
            Review and manage volunteer signups
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {Object.entries(filteredSignupsBySlot).map(([slot, slotSignups]) => (
            <div key={slot} className="space-y-2">
              <h3 className="font-medium text-sm text-muted-foreground">
                {project && formatScheduleSlot(project, slot)}
              </h3>
              <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slotSignups.map((signup) => (
                <TableRow key={signup.id}>
                  <TableCell className="font-medium">
                    {signup.user_id 
                      ? signup.profile?.full_name 
                      : signup.anonymous_name}
                  </TableCell>
                  <TableCell>
                    {signup.user_id ? (
                      <div>
                        <div className="text-sm text-muted-foreground">
                          @{signup.profile?.username}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div>{signup.anonymous_email || "No email provided"}</div>
                        <div className="text-sm text-muted-foreground">
                          {signup.anonymous_phone || "No phone provided"}
                        </div>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{getStatusBadge(signup.status)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => updateSignupStatus(signup.id, "cancelled")}
                      disabled={signup.status === "cancelled" || processingSignups[signup.id]}
                    >
                      {signup.status === "cancelled" ? (
                        "Rejected"
                      ) : processingSignups[signup.id] ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          <span className="inline-block">Rejecting...</span>
                        </>
                      ) : (
                        "Reject"
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && slotSignups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <div className="text-muted-foreground">
                      No signups yet
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
            </div>
          ))}

          {Object.keys(filteredSignupsBySlot).length === 0 && !loading && (
            <div className="text-center py-8 text-muted-foreground">
              No signups match your search
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
