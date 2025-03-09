import React from "react";
import { createClient } from "@/utils/supabase/server";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { NoAvatar } from "@/components/NoAvatar";
import { Metadata } from "next";
import { CalendarIcon, Calendar, MapPin } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

interface Profile {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  created_at: string;
}

interface Project {
  id: string;
  title: string;
  description: string;
  location: string;
  event_type: string;
  status: "active" | "completed" | "cancelled";
  created_at: string;
  cover_image_url?: string;
}

type Props = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata(
  params: Props,
): Promise<Metadata> {
  const { username } = await params.params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .single<Profile>();

  return {
    title: `${profile?.full_name} (${username})` || username,
    description: `Profile page for ${username}`,
  };
}

export default async function ProfilePage(
  params: Props,
): Promise<React.ReactElement> {
  const supabase = await createClient();
  const { username } = await params.params;
  
  // Fetch user profile data
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .single<Profile>();

  if (error || !profile) {
    notFound();
  }

  // Fetch projects created by this user
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("creator_id", profile.id)
    .order("created_at", { ascending: false });

  // Stats calculation
  const activeProjects = projects?.filter(p => p.status === "active").length || 0;
  const completedProjects = projects?.filter(p => p.status === "completed").length || 0;
  const totalProjects = projects?.length || 0;

  return (
    <div className="container max-w-5xl py-4 sm:py-8 px-4 sm:px-6 mx-auto">
      {/* Profile Header Card */}
      <Card className="mb-6 sm:mb-8 overflow-hidden">
      <div className="h-24 sm:h-32 bg-gradient-to-r from-primary/40 via-primary/20 to-primary/10"></div>
      <CardHeader className="pt-0 px-4 sm:px-6 pb-2">
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 -mt-6 sm:-mt-16">
        <Avatar className="h-20 w-20 sm:h-32 sm:w-32 border-4 border-background">
          <AvatarImage
          src={profile.avatar_url || undefined}
          alt={profile.full_name}
          />
          <AvatarFallback className="text-xl sm:text-2xl">
          <NoAvatar fullName={profile?.full_name} />
          </AvatarFallback>
        </Avatar>
        <div className="pt-1 sm:pt-16 flex flex-col">
          <h1 className="text-xl sm:text-2xl font-bold">{profile.full_name}</h1>
          <p className="text-muted-foreground text-sm">@{profile.username}</p>
        </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 sm:px-6 pt-2 pb-4">
        <div className="flex flex-col sm:flex-row justify-between gap-4 sm:gap-3">
        <div className="flex gap-2 flex-wrap">
          <Badge variant="secondary">{activeProjects} Active Projects</Badge>
          <Badge variant="outline">{completedProjects} Completed</Badge>
          <Badge variant="outline">{totalProjects} Total</Badge>
        </div>
        <div className="flex items-center text-xs text-muted-foreground">
          <CalendarIcon className="h-3 w-3 mr-1.5" />
          <span>Joined {format(new Date(profile.created_at), "MMMM yyyy")}</span>
        </div>
        </div>
      </CardContent>
      </Card>

      {/* Projects Section */}
      <div className="mb-6 sm:mb-8">
      <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4">Projects</h2>
      <Separator className="mb-4 sm:mb-6" />
      
      {projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {projects.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}`}>
          <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-3 sm:p-4">
            <div className="flex justify-between items-start gap-2 mb-2">
              <h3 className="font-semibold text-base sm:text-lg line-clamp-1">{project.title}</h3>
              <Badge 
              variant={project.status === "active" ? "default" : project.status === "completed" ? "secondary" : "destructive"}
              className="ml-auto flex-shrink-0 text-xs"
              >
              {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs sm:text-sm mb-2 sm:mb-3 line-clamp-2">
              {project.description.replace(/<[^>]*>/g, '')}
            </p>
            <div className="flex items-center text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 mr-1" />
              <span className="truncate">{project.location}</span>
            </div>
            <div className="flex items-center mt-1.5 sm:mt-2 text-xs text-muted-foreground">
              <CalendarIcon className="h-3 w-3 mr-1" />
              <span>Created {format(new Date(project.created_at), "MMM d, yyyy")}</span>
            </div>
            </CardContent>
          </Card>
          </Link>
        ))}
        </div>
      ) : (
        <div className="text-center p-8 bg-muted/20 rounded-lg">
        <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-lg font-medium mb-1">No Projects Yet</h3>
        <p className="text-muted-foreground">This user hasn&apos;t created any projects yet.</p>
        </div>
      )}
      </div>
    </div>
  );
}
