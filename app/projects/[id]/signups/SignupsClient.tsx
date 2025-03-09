"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Project } from "@/types";
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
import { CheckCircle2, XCircle, Clock, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Props {
  project: Project;
}

type Signup = {
  id: string;
  created_at: string;
  status: "pending" | "approved" | "rejected";
  user_id: string | null;
  anonymous_name: string | null;
  anonymous_email: string | null;
  anonymous_phone: string | null;
  schedule_id: string;
  user?: {
    email: string;
    profile: {
      full_name: string;
      username: string;
    };
  };
};

export default function ManageSignupsClient({ project }: Props) {
  const router = useRouter();
  const [signups, setSignups] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSignups();
  }, []);

  const loadSignups = async () => {
    const supabase = createClient();
    
    const { data, error } = await supabase
      .from("project_signups")
      .select(`
        *,
        user:user_id (
          email,
          profile:profiles (
            full_name,
            username
          )
        )
      `)
      .eq("project_id", project.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load signups");
      return;
    }

    setSignups(data as Signup[]);
    setLoading(false);
  };

  const updateSignupStatus = async (signupId: string, status: "approved" | "rejected") => {
    const supabase = createClient();
    
    const { error } = await supabase
      .from("project_signups")
      .update({ status })
      .eq("id", signupId);

    if (error) {
      toast.error("Failed to update signup status");
      return;
    }

    // Refresh the signups list
    loadSignups();
    toast.success(`Signup ${status} successfully`);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Rejected
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        );
    }
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

      <Card>
        <CardHeader>
          <CardTitle>Manage Volunteer Signups</CardTitle>
          <CardDescription>
            Review and manage volunteer signups for {project.title}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Role/Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signups.map((signup) => (
                <TableRow key={signup.id}>
                  <TableCell className="font-medium">
                    {signup.user_id
                      ? signup.user?.profile.full_name
                      : signup.anonymous_name}
                  </TableCell>
                  <TableCell>
                    {signup.user_id ? (
                      <div>
                        <div>{signup.user?.email}</div>
                        <div className="text-sm text-muted-foreground">
                          @{signup.user?.profile.username}
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
                  <TableCell>{signup.schedule_id}</TableCell>
                  <TableCell>{getStatusBadge(signup.status)}</TableCell>
                  <TableCell className="text-right">
                    <Select
                      defaultValue={signup.status}
                      onValueChange={(value: "approved" | "rejected") =>
                        updateSignupStatus(signup.id, value)
                      }
                    >
                      <SelectTrigger className="w-[130px]">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="approved">Approve</SelectItem>
                        <SelectItem value="rejected">Reject</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && signups.length === 0 && (
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
        </CardContent>
      </Card>
    </div>
  );
}