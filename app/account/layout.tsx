"use client";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Search, Menu, User, Shield, Key, Bell, Calendar } from "lucide-react";
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
    href: "/account/profile",
    icon: User,
  },
  {
    title: "Privacy & Security",
    href: "/account/security",
    icon: Shield,
  },
  {
    title: "Authentication",
    href: "/account/authentication",
    icon: Key,
  },
  {
    title: "Notifications",
    href: "/account/notifications",
    icon: Bell,
  },
  {
    title: "Calendar",
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
    item.title.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const pathname = usePathname();

  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col">
      {/* Mobile Header with Drawer */}
      <div className="lg:hidden flex items-center p-3 border-b sticky top-0 bg-background z-30">
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerTrigger asChild>
            <Button variant="ghost" size="icon" className="mr-2">
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
                  className="pl-9 h-9 text-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
              {filteredItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <Button
                      variant="ghost"
                      className={`w-full justify-start h-10 ${
                        pathname === item.href
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-muted-foreground"
                      }`}
                      onClick={() => setIsDrawerOpen(false)}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      {item.title}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </DrawerContent>
        </Drawer>
        <div className="flex-1 relative">
          <Input
            placeholder="Search settings..."
            className="pl-9 h-9 text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Only visible on desktop */}
        <aside className="hidden lg:block w-72 border-r overflow-y-auto">
          <div className="sticky top-0 p-4 bg-background z-10">
            <div className="relative mb-4">
              <Input
                placeholder="Search settings..."
                className="pl-9 h-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          <div className="px-3 space-y-1">
            {filteredItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant="ghost"
                    className={`w-full justify-start ${
                      pathname === item.href
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {item.title}
                  </Button>
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
