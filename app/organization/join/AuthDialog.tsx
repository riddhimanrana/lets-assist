"use client";


import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Building2, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";

interface AuthDialogProps {
  organization: {
    name: string;
    username: string;
    logo_url: string | null;
  };
  joinCode: string;
}

export default function AuthDialog({ organization, joinCode }: AuthDialogProps) {
  return (
    <Card className="w-full max-w-md mx-4">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={organization.logo_url || undefined} />
            <AvatarFallback>
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </AvatarFallback>
          </Avatar>
        </div>
        <CardTitle className="text-2xl">Join {organization.name}</CardTitle>
        <CardDescription>
          Sign in or create an account to join this organization
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          asChild
          className="w-full"
          variant="default"
        >
          <Link href={`/login?redirect=/organization/join?code=${joinCode}`}>
            <LogIn className="h-4 w-4 mr-2" />
            Sign In to Join
          </Link>
        </Button>
        
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">
              or
            </span>
          </div>
        </div>

        <Button 
          asChild
          variant="outline"
          className="w-full"
        >
          <Link href={`/signup?redirect=/organization/join?code=${joinCode}`}>
            <UserPlus className="h-4 w-4 mr-2" />
            Create New Account
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
