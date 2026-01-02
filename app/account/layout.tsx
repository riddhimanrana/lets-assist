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
      <div className="lg:hidden flex items-center p-3 border-b sticky top-0 bg-background/95 backdrop-blur-sm z-30">
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerTrigger asChild>
            <Button variant="ghost" size="icon" className="mr-2 shrink-0">
              <Menu className="h-5 w-5" />
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="border-b px-4">
              <DrawerTitle>Account Settings</DrawerTitle>
            </DrawerHeader>
            <div className="p-4 space-y-2">
              {/* Search input for drawer */}
              <div className="relative mb-4">
                <Input
                  placeholder="Search settings..."
                  className="pl-9 h-10 text-sm bg-muted/50"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
              {filteredItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={`flex items-center gap-3 rounded-lg px-3 py-3 transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                      onClick={() => setIsDrawerOpen(false)}
                    >
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${isActive ? 'bg-primary/20' : 'bg-muted'}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isActive ? '' : ''}`}>{item.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </DrawerContent>
        </Drawer>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold truncate">{currentItem?.title || "Settings"}</h2>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Only visible on desktop */}
        <aside className="hidden lg:block w-72 border-r bg-background overflow-y-auto">
          <div className="sticky top-0 p-4 bg-background z-10 border-b">
            <h2 className="text-lg font-semibold mb-3">Account Settings</h2>
            <div className="relative">
              <Input
                placeholder="Search settings..."
                className="pl-9 h-10 bg-muted/50"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          <div className="p-3 space-y-1">
            {filteredItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200 ${
                      isActive
                        ? "bg-primary/10 text-primary shadow-sm"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${isActive ? 'bg-primary/20' : 'bg-muted'}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </aside>

        {/* Main content - Full width on mobile, partial width on desktop */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
