"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LayoutDashboard, MessageSquare, ShieldAlert, Users } from "lucide-react";

interface AdminSidebarProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

export function AdminSidebar({ activeTab, onTabChange }: AdminSidebarProps = {}) {
  const pathname = usePathname();

  const navItems = [
    { id: "overview", href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
    { id: "feedback", href: "/admin/feedback", label: "Feedback", icon: MessageSquare },
    { id: "trusted-members", href: "/admin/trusted-members", label: "Trusted Members", icon: Users },
    { id: "moderation", href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
  ];

  return (
    <div className="w-64 border-r bg-muted/10 min-h-[calc(100vh-4rem)] p-4 space-y-2 hidden md:block">
      <div className="mb-6 px-2">
        <h2 className="text-lg font-semibold tracking-tight">Admin Console</h2>
        <p className="text-sm text-muted-foreground">Manage your platform</p>
      </div>
      <nav className="space-y-1">
        {navItems.map((item) => {
          const isActive = activeTab !== undefined
            ? activeTab === item.id
            : item.exact 
              ? pathname === item.href 
              : pathname.startsWith(item.href);

          const buttonProps = onTabChange
            ? {
                onClick: () => onTabChange(item.id),
                asChild: false,
              }
            : {
                asChild: true,
              };

          return (
            <Button
              key={item.id}
              variant={isActive ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-2",
                isActive && "bg-secondary"
              )}
              {...buttonProps}
            >
              {onTabChange ? (
                <>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </>
              ) : (
                <Link href={item.href}>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )}
            </Button>
          );
        })}
      </nav>
    </div>
  );
}
