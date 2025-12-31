"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ExternalLink, Lock, LogIn, Shield, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";

interface ProjectUnauthorizedProps {
  projectId: string;
}

export default function ProjectUnauthorized({ projectId }: ProjectUnauthorizedProps) {
  const router = useRouter();
  const { user, isLoading } = useAuth(); // Use centralized auth hook
  const [isRedirecting, setIsRedirecting] = useState(false);
  const isLoggedIn = !!user;

  return (
    <div className="flex items-center justify-center w-full min-h-screen px-4 py-6">
      <div className="w-full max-w-md mx-auto">
        <Card className="border-destructive/20 shadow-md w-full">
          <CardHeader className="pb-2 pt-5">
            <div className="flex items-center justify-center mb-4">
              <div className="bg-destructive/10 rounded-full p-3">
                <Lock className="h-8 w-8 text-destructive" />
              </div>
            </div>
            <CardTitle className="text-2xl text-center">Private Project</CardTitle>
            <CardDescription className="text-center text-sm mt-1">
              This project is private and requires organization access
            </CardDescription>
          </CardHeader>

          <CardContent className="text-center space-y-4 px-5">
            {!isLoading && !isLoggedIn && (
              <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 py-2">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle className="text-sm">Authentication required</AlertTitle>
                <AlertDescription className="text-xs">You need to log in to access this private project.</AlertDescription>
              </Alert>
            )}

            <div className="p-3 bg-muted/50 rounded-lg border border-border">
              <h3 className="font-medium mb-2 flex items-center justify-center text-sm">
                <Users className="h-4 w-4 mr-2" />
                Access Requirements
              </h3>
              <Separator className="my-1.5" />
              <ul className="mt-2 space-y-2 text-left text-sm">
                <li className="flex items-center">
                  <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-xs font-medium text-primary mr-2">
                    1
                  </span>
                  <span>Be a member of the organization that owns this project</span>
                </li>
                {!isLoggedIn && (
                  <li className="flex items-center">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-xs font-medium text-primary mr-2">
                      2
                    </span>
                    <span>Log in with an account that has access to this organization</span>
                  </li>
                )}
                <li className="flex items-center">
                  <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-xs font-medium text-primary mr-2">
                    {!isLoggedIn ? "3" : "2"}
                  </span>
                  <span>Request access from the organization administrator if needed</span>
                </li>
              </ul>
            </div>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-center p-2 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors cursor-help">
                    <Shield className="h-4 w-4 text-muted-foreground mr-2 flex-shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      Private projects help organizations maintain confidentiality
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-xs">Organization administrators can manage access in the project settings</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardContent>

          <CardFooter className="flex flex-col gap-3 px-5 pb-5">
            {!isLoading && !isLoggedIn && (
              <Button
                variant="default"
                onClick={() => {
                  setIsRedirecting(true);
                  router.push("/login");
                }}
                disabled={isRedirecting}
                className="w-full"
                size="sm"
              >
                <LogIn className="mr-2 h-4 w-4" />
                {isRedirecting ? "Redirecting..." : "Log In to Access"}
              </Button>
            )}

            <div className="flex flex-col sm:flex-row gap-3 w-full">
              <Button variant="outline" asChild className="w-full" size="sm">
                <Link href="/organization/join">
                  Join Organization
                  <ExternalLink className="ml-2 h-3 w-3" />
                </Link>
              </Button>

              <Button variant="ghost" asChild className="w-full" size="sm">
                <Link href="/projects">Browse Public Projects</Link>
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}