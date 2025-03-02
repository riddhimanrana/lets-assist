// components/Navbar.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import {
  Menu,
  UserRound,
  LogOut,
  LayoutDashboard,
  Settings,
  Heart,
  Bug,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { NoAvatar } from "@/components/NoAvatar";
import { createClient } from "@/utils/supabase/client";
import { User as SupabaseUser } from "@supabase/supabase-js";
import { logout } from "@/app/logout/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { ModeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportBugDialog } from "@/components/ReportBugDialog";
import { useState } from "react";
import Image from "next/image";

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const CollapsibleSection = ({
  title,
  children,
  defaultOpen = false,
}: SectionProps) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <div className="mb-4">
      <button
        className="flex w-full items-center justify-between py-2"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-base font-bold">{title}</span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>
      {isOpen && <div className="mt-1 space-y-1">{children}</div>}
    </div>
  );
};

const features = [
  {
    title: "Personalized Project Matching",
    href: "/features/feature-1",
    description: "Smart project recommendations",
  },
  {
    title: "Stay Updated, Stay Involved",
    href: "/features/feature-2",
    description: "Real-time updates on projects",
  },
  {
    title: "Celebrate Your Contributions",
    href: "/features/feature-3",
    description: "Certificates, Badges, and more",
  },
];

interface NavbarProps {
  initialUser: SupabaseUser | null;
}

export default function Navbar({ initialUser }: NavbarProps) {
  const [user, setUser] = React.useState<SupabaseUser | null>(initialUser);
  const [profile, setProfile] = React.useState<{
    full_name: string;
    avatar_url: string;
    username: string;
  } | null>(null);
  const [isProfileLoading, setIsProfileLoading] = React.useState(true);
  const [showBugDialog, setShowBugDialog] = useState(false);

  React.useEffect(() => {
    async function getUserAndProfile() {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setUser(null);
        setProfile(null);
        setIsProfileLoading(false);
        return;
      }

      setUser(user);

      const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, username")
        .eq("id", user.id)
        .single();

      setProfile(profileData);
      setIsProfileLoading(false);
    }

    getUserAndProfile();
  }, []);
  return (
    <>
      <div>
        <nav className="flex items-center justify-between p-3 bg-background">
          <Link href="/">
            <div className="flex items-center space-x-2">
              <Image
                src="/letsassist-logo.png"
                alt="letsassist logo"
                width={30}
                height={30}
              />
              <span className="text-lg font-bold">letsassist</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-6 ml-auto">
            <NavigationMenu>
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger>Features</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <ul className="grid gap-3 p-6 md:w-[400px] lg:w-[500px] lg:grid-cols-[.75fr_1fr]">
                      <li className="row-span-3">
                        <NavigationMenuLink asChild>
                          <a
                            className="flex h-full w-full select-none flex-col justify-end rounded-md bg-gradient-to-b from-muted/50 to-muted p-6 no-underline outline-none focus:shadow-md"
                            href="/"
                          >
                            <Image
                              src="/letsassist-logo.png"
                              alt="letsassist logo"
                              width={30}
                              height={30}
                            />
                            <div className="mb-2 mt-4 text-lg font-medium">
                              letsassist
                            </div>
                            <p className="text-sm leading-tight text-muted-foreground">
                              Helping communities and volunteers connect
                            </p>
                          </a>
                        </NavigationMenuLink>
                      </li>
                      {features.map((feature) => (
                        <ListItem
                          key={feature.title}
                          title={feature.title}
                          href={feature.href}
                        >
                          {feature.description}
                        </ListItem>
                      ))}
                    </ul>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
            <Button variant="ghost">Volunteering Near Me</Button>
            <Button variant="ghost">Connected Organizations</Button>
          </div>
          <div className="hidden sm:flex items-center space-x-6 ml-auto">
            {user ? (
              <div className="flex items-center space-x-8">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    {isProfileLoading ? (
                      <Skeleton className="w-9 h-9 rounded-full" />
                    ) : (
                      <Avatar className="w-9 h-9 cursor-pointer">
                        <AvatarImage src={profile?.avatar_url} />
                        <AvatarFallback>
                          <NoAvatar fullName={profile?.full_name} />
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="w-64 pt-3 px-2 pb-2"
                    align="end"
                    forceMount
                  >
                    <DropdownMenuLabel className="font-normal mb-2">
                      <div className="flex flex-col space-y-2">
                        <p className="text-sm font-medium leading-tight">
                          {profile?.full_name}
                        </p>
                        <p className="text-sm leading-none text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>

                    <DropdownMenuItem
                      className="py-2.5 text-muted-foreground cursor-pointer"
                      asChild
                    >
                      <Link href="/home">
                        <span>Dashboard</span>
                      </Link>
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      className="py-2.5 text-muted-foreground cursor-pointer"
                      asChild
                    >
                      <Link href="/account/profile">
                        <span>Account Settings</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="py-2.5 text-muted-foreground cursor-pointer"
                      asChild
                    >
                      <Link href={`/profile/${profile?.username}`}>
                        <span>My Profile</span>
                      </Link>
                    </DropdownMenuItem>

                    <DropdownMenuSeparator className="my-2" />
                    <DropdownMenuItem
                      className="text-chart-3 focus:text-chart-3 py-2.5 cursor-pointer flex justify-between"
                      onSelect={(e) => {
                        e.preventDefault();
                        setShowBugDialog(true);
                      }}
                    >
                      Report a Bug
                      <Bug className="h-4 w-4" />
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-chart-4 focus:text-chart-4 py-2.5 cursor-pointer flex justify-between">
                      <span>Donate</span>
                      <Heart className="h-4 w-4" />
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-2" />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive py-2.5 cursor-pointer flex justify-between"
                      onClick={async () => {
                        setUser(null);
                        await logout();
                      }}
                    >
                      <span>Log Out</span>
                      <LogOut className="h-4 w-4" />
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost">Login</Button>
                </Link>
                <Link href="/signup">
                  <Button>Sign Up</Button>
                </Link>
              </>
            )}
            <div className="ml-4">
              <ModeToggle />
            </div>
          </div>

          {/* Mobile Navigation */}
          <Sheet>
            <SheetTitle className="hidden"></SheetTitle>
            <div className="sm:hidden flex items-center ml-auto">
              <ModeToggle />
            </div>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden ml-2">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85%] sm:w-[380px] pt-6">
              <div className="flex flex-col h-full">
                <div className="space-y-4 flex-1">
                  {user && (
                    <div className="flex items-center space-x-3 mb-6 pb-4 border-b">
                      {isProfileLoading ? (
                        <Skeleton className="w-12 h-12 rounded-full" />
                      ) : (
                        <Avatar className="w-12 h-12">
                          <AvatarImage src={profile?.avatar_url} />
                          <AvatarFallback>
                            <NoAvatar fullName={profile?.full_name} />
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className="flex flex-col">
                        <p className="font-medium">{profile?.full_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </div>
                  )}

                  <CollapsibleSection title="Navigation" defaultOpen={true}>
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-muted-foreground"
                      asChild
                    >
                      <Link href="/">Home</Link>
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-muted-foreground"
                    >
                      Volunteering Near Me
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-muted-foreground"
                    >
                      Connected Organizations
                    </Button>
                  </CollapsibleSection>

                  {user && (
                    <>
                      <CollapsibleSection title="Dashboard" defaultOpen={true}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start text-muted-foreground"
                          asChild
                        >
                          <Link href="/home">
                            <LayoutDashboard className="mr-2 h-4 w-4" />
                            Dashboard
                          </Link>
                        </Button>
                      </CollapsibleSection>

                      <CollapsibleSection title="Account" defaultOpen={true}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start text-muted-foreground"
                          asChild
                        >
                          <Link href="/account/profile">
                            <Settings className="mr-2 h-4 w-4" />
                            Account Settings
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          className="w-full justify-start text-muted-foreground"
                          asChild
                        >
                          <Link href={`/profile/${profile?.username}`}>
                            <UserRound className="mr-2 h-4 w-4" />
                            My Profile
                          </Link>
                        </Button>
                      </CollapsibleSection>
                    </>
                  )}
                </div>

                {user ? (
                  <div className="border-t pt-4 mt-auto">
                    <p className="text-base font-bold mb-2 pl-2">Support</p>
                    <Button
                      variant="ghost"
                      className="w-full justify-start mb-2 text-muted-foreground"
                      onClick={() => setShowBugDialog(true)}
                    >
                      <Bug className="mr-2 h-4 w-4" />
                      Report a Bug
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start mb-2 text-muted-foreground"
                    >
                      <Heart className="mr-2 h-4 w-4" />
                      Donate
                    </Button>
                    <Button
                      variant="destructive"
                      className="w-full mt-2"
                      onClick={async () => {
                        setUser(null);
                        await logout();
                      }}
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Log Out
                    </Button>
                  </div>
                ) : (
                  <div className="border-t pt-4 mt-auto">
                    <div className="grid gap-2">
                      <Link href="/login" className="w-full">
                        <Button variant="outline" className="w-full">
                          Login
                        </Button>
                      </Link>
                      <Link href="/signup" className="w-full">
                        <Button className="w-full">Sign Up</Button>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
      <Separator />
      {showBugDialog && (
        <ReportBugDialog onOpenChangeAction={setShowBugDialog} />
      )}
    </>
  );
}

const ListItem = React.forwardRef<
  React.ComponentRef<"a">,
  React.ComponentPropsWithoutRef<"a">
>(({ className, title, children, ...props }, ref) => {
  return (
    <li>
      <NavigationMenuLink asChild>
        <a
          ref={ref}
          className={cn(
            "block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
            className,
          )}
          {...props}
        >
          <div className="text-sm font-medium leading-none">{title}</div>
          <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
            {children}
          </p>
        </a>
      </NavigationMenuLink>
    </li>
  );
});
ListItem.displayName = "ListItem";
