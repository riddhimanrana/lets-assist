"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { redirect } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { usePathname } from "next/navigation";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [authorized, setAuthorized] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || user.email !== "riddhiman.rana@gmail.com") {
        redirect("/404");
      } else {
        setAuthorized(true);
      }
    };

    checkAuth();
  }, []);

  if (!authorized) return null;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="container mx-auto py-4">
          <div className="flex">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/admin">Admin</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                {pathname.includes("/admin/bug-reports") && (
                  <BreadcrumbItem>
                    <BreadcrumbPage>Bug Reports</BreadcrumbPage>
                  </BreadcrumbItem>
                )}
                {pathname.includes("/admin/users") && (
                  <BreadcrumbItem>
                    <BreadcrumbPage>Users</BreadcrumbPage>
                  </BreadcrumbItem>
                )}
                {pathname.includes("/admin/settings") && (
                  <BreadcrumbItem>
                    <BreadcrumbPage>Settings</BreadcrumbPage>
                  </BreadcrumbItem>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </div>
      </div>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
