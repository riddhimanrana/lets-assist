import { createClient } from "@/utils/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Metadata } from "next";
import { Plus, Building2, Users2, ExternalLink } from "lucide-react";
import { JoinOrganizationDialog } from "./JoinOrganizationDialog";
import { NoAvatar } from "@/components/NoAvatar";

export const metadata: Metadata = {
  title: "Organizations",
  description: "Explore and join organizations",
};

export default async function OrganizationsPage() {
  const supabase = await createClient();

  const { data: { session } } = await supabase.auth.getSession();
  const isLoggedIn = !!session;
  
  // Fetch organizations
  const { data: organizations } = await supabase
    .from("organizations")
    .select(`
      id,
      name,
      username,
      description,
      website,
      logo_url,
      type,
      verified,
      created_at,
      organization_members!inner(user_id)
    `)
    .order('created_at', { ascending: false });

  // Get all organization_members
  const { data: memberCounts } = await supabase
    .from("organization_members")
    .select('organization_id', { count: 'exact', head: false });

  // Create a map of org ID to member count
  // Create a map of org ID to member count
  const orgMemberCounts = (memberCounts || []).reduce((acc, item) => {
    acc[item.organization_id] = (acc[item.organization_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return (
    <div className="flex flex-col items-center px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
      <div className="w-full max-w-7xl space-y-4 sm:space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Organizations</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Join or create organizations to collaborate on projects
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {isLoggedIn && (
              <>
                <JoinOrganizationDialog />
                <Button className="w-full sm:w-auto" asChild>
                  <Link href="/organization/create">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Organization
                  </Link>
                </Button>
              </>
            )}
            {!isLoggedIn && (
              <Button className="w-full sm:w-auto" asChild variant="outline">
                <Link href="/login?redirect=/organization">
                  Sign In to Join or Create
                </Link>
              </Button>
            )}
          </div>
        </div>

        <Separator />

        {organizations?.length === 0 && (
          <div className="text-center py-8 sm:py-16">
            <Building2 className="mx-auto h-10 sm:h-12 w-10 sm:w-12 text-muted-foreground" />
            <h3 className="mt-3 sm:mt-4 text-base sm:text-lg font-semibold">No organizations yet</h3>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground">
              Be the first to create an organization!
            </p>
            {isLoggedIn && (
              <Button asChild className="mt-4">
                <Link href="/organization/create">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Organization
                </Link>
              </Button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {organizations?.map((org) => (
            <Link href={`/organization/${org.username}`} key={org.id}>
              <Card className="h-full overflow-hidden hover:shadow-md transition-shadow">
                <CardContent className="p-0">
                  <div className="h-20 sm:h-24 bg-gradient-to-r from-primary/40 via-primary/20 to-primary/10 relative">
                    {org.logo_url && (
                        <div className="absolute bottom-0 left-4 transform translate-y-1/2">
                        <Avatar className="h-12 w-12 sm:h-14 sm:w-14 rounded-full border-4 border-background">
                          <AvatarImage src={org.logo_url} alt={org.name} />
                          <AvatarFallback>
                            <NoAvatar fullName={org.name} className="text-base" />
                          </AvatarFallback>
                        </Avatar>
                        </div>
                    )}
                    {!org.logo_url && (
                      <div className="absolute bottom-0 left-4 transform translate-y-1/2 rounded-full bg-muted border-4 border-background h-12 w-12 sm:h-14 sm:w-14 flex items-center justify-center">
                        <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  
                  <div className="pt-8 sm:pt-10 px-3 sm:px-4 pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-base sm:text-lg line-clamp-1">{org.name}</h3>
                          {org.verified && (
                            <Badge variant="default" className="text-xs">Verified</Badge>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm text-muted-foreground">@{org.username}</p>
                      </div>
                      <Badge variant="outline" className="text-xs capitalize">
                        {org.type}
                      </Badge>
                    </div>
                    
                    <p className="mt-2 text-xs sm:text-sm line-clamp-2 text-muted-foreground">
                      {org.description || "No description provided"}
                    </p>
                  </div>
                </CardContent>
                
                <CardFooter className="px-3 sm:px-4 py-2 sm:py-3 flex justify-between border-t bg-muted/10">
                  <div className="flex items-center text-xs sm:text-sm text-muted-foreground">
                    <Users2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5" />
                    <span>{orgMemberCounts[org.id] || 0} members</span>
                  </div>
                  
                  {org.website && (
                    <div className="flex items-center text-xs sm:text-sm">
                      <ExternalLink className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5" />
                      <span className="max-w-[100px] sm:max-w-[150px] truncate">
                        {org.website.replace(/^https?:\/\//, '')}
                      </span>
                    </div>
                  )}
                </CardFooter>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
