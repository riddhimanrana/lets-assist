"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Mail } from "lucide-react";
import { SiInstagram, SiX } from "react-icons/si";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type FooterSystemStatus = "operational" | "degraded" | "outage" | "unknown";

const FOOTER_STATUS_META: Record<
  FooterSystemStatus,
  {
    label: string;
    dotClassName: string;
    badgeClassName: string;
  }
> = {
  operational: {
    label: "Operational",
    dotClassName: "bg-success",
    badgeClassName: "border-success/35 bg-success/10 text-success",
  },
  degraded: {
    label: "Degraded",
    dotClassName: "bg-warning",
    badgeClassName: "border-warning/35 bg-warning/10 text-warning",
  },
  outage: {
    label: "Outage",
    dotClassName: "bg-destructive",
    badgeClassName: "border-destructive/35 bg-destructive/10 text-destructive",
  },
  unknown: {
    label: "Checking",
    dotClassName: "bg-warning",
    badgeClassName: "border-warning/35 bg-warning/10 text-warning",
  },
};

export function Footer() {
  const { user } = useAuth();
  const [systemStatus, setSystemStatus] = useState<FooterSystemStatus>("unknown");

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchStatus = async () => {
      try {
        const response = await fetch("/api/status", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          if (isMounted) setSystemStatus("outage");
          return;
        }

        const payload = (await response.json()) as { status?: string };
        const next = payload.status;

        if (!isMounted) return;

        if (next === "operational" || next === "degraded" || next === "outage") {
          setSystemStatus(next);
          return;
        }

        setSystemStatus("unknown");
      } catch {
        if (isMounted) setSystemStatus("unknown");
      }
    };

    fetchStatus();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  const currentYear = new Date().getFullYear();
  const primaryLink = user
    ? { href: "/trusted-member", label: "Trusted Member" }
    : { href: "/", label: "Home" };

  const footerLinks = useMemo(
    () => [
      primaryLink,
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/help", label: "Help" },
      { href: "/contact", label: "Contact" },
      { href: "/acknowledgements", label: "Acknowledgements" },
    ],
    [primaryLink]
  );

  const statusMeta = FOOTER_STATUS_META[systemStatus];

  const statusBadge = (
    <Tooltip>
      <TooltipTrigger className="inline-flex items-center align-middle">
        <Link
          href="https://status.lets-assist.com"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none align-middle transition-colors hover:opacity-90",
            statusMeta.badgeClassName
          )}
          aria-label={`System status: ${statusMeta.label}`}
        >
          <span className={cn("size-2 rounded-full", statusMeta.dotClassName)} aria-hidden="true" />
          <span className="leading-none">{statusMeta.label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top">
        Current system status based on our latest checks.
      </TooltipContent>
    </Tooltip>
  );

  return (
    <footer className="w-full border-t py-8 md:py-6">
      <div className="container px-4 mx-auto">
        {/* Mobile layout */}
        <div className="flex flex-col gap-6 md:hidden">
          <div className="flex justify-start ml-3">
            <Image
              src="/logo.png"
              alt="letsassist Logo"
              width={40}
              height={40}
              className="h-8 w-auto"
            />
          </div>

          <nav className="grid grid-cols-2 gap-x-6 gap-y-3 text-left ml-3">
            {footerLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-3 mr-3 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <p className="text-xs text-muted-foreground whitespace-nowrap">
                  © {currentYear} Riddhiman Rana
                </p>
                {statusBadge}
              </div>

              <div className="flex items-center space-x-3 shrink-0">
                <Link
                  href="https://instagram.com/letsassist.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Instagram"
                >
                  <SiInstagram className="h-4 w-4" />
                </Link>
                <Link
                  href="https://x.com/letsassistapp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Twitter"
                >
                  <SiX className="h-4 w-4" />
                </Link>
                <Link
                  href="mailto:contact@lets-assist.com"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Email"
                >
                  <Mail className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop layout */}
        <div className="hidden md:flex md:items-center md:justify-between md:gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <Image src="/logo.png" alt="letsassist Logo" width={32} height={32} />
            <p className="text-sm text-muted-foreground whitespace-nowrap">
              © {currentYear} Riddhiman Rana
              <span className="hidden xl:inline">. All rights reserved.</span>
            </p>
            {statusBadge}
          </div>

          <div className="flex items-center gap-6">
            <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-left">
              {footerLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center space-x-3 shrink-0">
              <Link
                href="https://instagram.com/letsassist.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Instagram"
              >
                <SiInstagram className="h-4 w-4" />
              </Link>
              <Link
                href="https://x.com/letsassistapp"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Twitter"
              >
                <SiX className="h-4 w-4" />
              </Link>
              <Link
                href="mailto:contact@lets-assist.com"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Email"
              >
                <Mail className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
