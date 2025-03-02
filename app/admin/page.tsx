"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Card } from "@/components/ui/card";
import Link from "next/link";
import { Bug, Settings, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) throw authError;

        if (!user || user.email !== "riddhiman.rana@gmail.com") {
          redirect("/404");
        } else {
          setAuthorized(true);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "An error occurred");
        redirect("/404");
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const adminLinks = [
    {
      title: "Bug Reports",
      description: "View and manage user-reported issues",
      href: "/admin/bug-reports",
      icon: Bug,
    },
    {
      title: "User Management",
      description: "Manage user accounts and permissions",
      href: "/admin/users",
      icon: Users,
    },
    {
      title: "Site Settings",
      description: "Configure global site settings",
      href: "/admin/settings",
      icon: Settings,
    },
  ];

  if (loading) {
    return (
      <div className="container mx-auto py-10">
        <div className="flex flex-col items-center text-center mb-12">
          <Skeleton className="h-12 w-64 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) return null;

  if (!authorized) return null;

  return (
    <div className="container py-10">
      <div className="flex flex-col items-center text-center mb-12">
        <h1 className="text-4xl font-bold mb-2">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Logged in as: riddhiman.rana@gmail.com
        </p>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {adminLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link href={link.href} key={link.href}>
              <Card className="p-6 hover:bg-muted/50 transition-colors cursor-pointer h-full">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <Icon className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-semibold mb-2">{link.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      {link.description}
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
