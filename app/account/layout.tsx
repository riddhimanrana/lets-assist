"use client";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Search, Menu, User, Shield, Key, Bell, Calendar, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

const sidebarItems = [
  {
    title: "Profile",
    description: "Personal info & picture",
    href: "/account/profile",
    icon: User,
  },
  {
    title: "Privacy & Security",
    description: "Visibility settings",
    href: "/account/security",
    icon: Shield,
  },
  {
    title: "Authentication",
    description: "Password & login",
    href: "/account/authentication",
    icon: Key,
  },
  {
    title: "Notifications",
    description: "Email & push preferences",
    href: "/account/notifications",
    icon: Bell,
  },
  {
    title: "Calendar",
    description: "Sync & integrations",
    href: "/account/calendar",
    icon: Calendar,
  },
];

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredItems = sidebarItems.filter((item) =>
    item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.description.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const pathname = usePathname();
  const currentItem = sidebarItems.find((item) => pathname === item.href);

  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col bg-muted/30">
      {/* Mobile Header with Drawer */}
      <div className="lg:hidden flex items-center gap-2 px-4 py-3 border-b sticky top-0 bg-background/95 backdrop-blur-sm z-30">
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0">
              <Menu className="h-5 w-5" />
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="border-b px-5 pb-4">
              <DrawerTitle className="text-lg">Account Settings</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pt-4 pb-6 space-y-1">
              {/* Search input for drawer */}
              <div className="relative mb-3">
                <Input
                  placeholder="Search settings..."
                  className="pl-9 h-10 text-sm bg-muted/50"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
              {filteredItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={`flex items-center gap-3 rounded-xl px-3 py-3 transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                      onClick={() => setIsDrawerOpen(false)}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isActive ? 'bg-primary/20 text-primary' : 'bg-muted'}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-none mb-1">{item.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </DrawerContent>
        </Drawer>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold leading-none truncate">{currentItem?.title || "Settings"}</h2>
          {currentItem && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{currentItem.description}</p>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Only visible on desktop */}
        <aside className="hidden lg:flex lg:flex-col w-72 border-r bg-background overflow-y-auto">
          {/* Header */}
          <div className="px-5 pt-6 pb-5 border-b">
            <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Manage your account</p>
          </div>
          {/* Search */}
          <div className="px-4 py-4">
            <div className="relative">
              <Input
                placeholder="Search settings..."
                className="pl-9 h-9 bg-muted/50 text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          {/* Nav */}
          <nav className="flex-1 px-3 pb-4 space-y-0.5">
            {filteredItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={`group flex items-center gap-3 rounded-xl px-3 py-3 transition-all duration-150 ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      isActive ? "bg-primary/20 text-primary" : "bg-muted group-hover:bg-background"
                    }`}>
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-none mb-1">{item.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
