import React from "react";
import { createClient } from "@/utils/supabase/server";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { NoAvatar } from "@/components/NoAvatar";
import { Metadata } from "next";
import { CalendarIcon } from "lucide-react";

interface Profile {
  username: string;
  full_name: string;
  avatar_url: string | null;
  created_at: string;
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

  return (
    <div className="container max-w-4xl py-8 mx-auto">
      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          <Avatar className="h-20 w-20">
            <AvatarImage
              src={profile.avatar_url || undefined}
              alt={profile.full_name}
            />
            <AvatarFallback>
              <NoAvatar fullName={profile?.full_name} />
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold">{profile.full_name}</h1>
            <p className="text-muted-foreground">@{profile.username}</p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                <span>
                  Joined {format(new Date(profile.created_at), "MMMM yyyy")}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
