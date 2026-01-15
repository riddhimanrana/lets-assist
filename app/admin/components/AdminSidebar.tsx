"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Mail, Menu, MessageSquare, ShieldAlert, Users } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface AdminSidebarProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

const navItems = [
  { id: "overview", href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { id: "emails", href: "/admin/emails", label: "Emails", icon: Mail },
  { id: "feedback", href: "/admin/feedback", label: "Feedback", icon: MessageSquare },
  { id: "trusted-members", href: "/admin/trusted-members", label: "Trusted Members", icon: Users },
  { id: "moderation", href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
];

export function AdminSidebar({ activeTab, onTabChange }: AdminSidebarProps = {}) {
  const pathname = usePathname();

  return (
    <div className="hidden w-64 flex-col border-r bg-muted/10 p-4 md:flex md:h-screen md:sticky md:top-0">
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
                <Link href={item.href} className="flex items-center gap-2">
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

export function AdminMobileNav({ activeTab, onTabChange }: AdminSidebarProps = {}) {
  const pathname = usePathname();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open admin menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-4">
        <SheetHeader className="text-left">
          <SheetTitle>Admin Console</SheetTitle>
          <SheetDescription>Navigate admin tools</SheetDescription>
        </SheetHeader>
        <nav className="mt-6 space-y-2">
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
                className={cn("w-full justify-start gap-2", isActive && "bg-secondary")}
                {...buttonProps}
              >
                {onTabChange ? (
                  <>
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </>
                ) : (
                  <Link href={item.href} className="flex items-center gap-2">
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                )}
              </Button>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
