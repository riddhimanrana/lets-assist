"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Menu, MessageSquare, ShieldAlert, Users, BellRing, FileText, BadgeCheck, UserX, Megaphone } from "lucide-react";
import {
  Sheet,
  SheetClose,
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
  { id: "notifications", href: "/admin/notifications", label: "Notifications", icon: BellRing },
  { id: "system-banner", href: "/admin/system-banner", label: "System Banner", icon: Megaphone },
  { id: "user-access", href: "/admin/user-access", label: "User Access", icon: UserX },
  { id: "organizations", href: "/admin/organizations", label: "Organizations", icon: BadgeCheck },
  { id: "feedback", href: "/admin/feedback", label: "Feedback", icon: MessageSquare },
  { id: "trusted-members", href: "/admin/trusted-members", label: "Trusted Members", icon: Users },
  { id: "moderation", href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
  { id: "waivers", href: "/admin/waivers", label: "Waivers", icon: FileText },
];

export function AdminSidebar({ activeTab, onTabChange }: AdminSidebarProps = {}) {
  const pathname = usePathname();

  return (
    <div className="hidden w-64 flex-col border-r bg-muted/10 p-4 md:flex md:h-screen md:sticky md:top-0">
      <div className="mb-6 px-2">
        <h2 className="text-lg font-semibold tracking-tight">Admin Console</h2>
        <p className="text-sm text-muted-foreground">Manage your platform</p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
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
      <SheetTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "md:hidden")}>
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="flex h-full w-72 flex-col p-4">
        <SheetHeader className="text-left">
          <SheetTitle>Admin Console</SheetTitle>
          <SheetDescription>Navigate admin tools</SheetDescription>
        </SheetHeader>
        <nav className="mt-6 flex-1 space-y-2 overflow-y-auto pr-1">
          {navItems.map((item) => {
            const isActive = activeTab !== undefined
              ? activeTab === item.id
              : item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);

            if (onTabChange) {
              return (
                <SheetClose
                  key={item.id}
                  className={cn(buttonVariants({ variant: isActive ? "secondary" : "ghost" }), "w-full justify-start gap-2", isActive && "bg-secondary")}
                  onClick={() => onTabChange(item.id)}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </SheetClose>
              );
            }

            return (
              <SheetClose
                key={item.id}
                render={
                  <Link
                    href={item.href}
                    className={cn(buttonVariants({ variant: isActive ? "secondary" : "ghost" }), "w-full justify-start gap-2 flex items-center", isActive && "bg-secondary")}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                }
              />
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
