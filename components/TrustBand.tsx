"use client";

import { CalendarCheck, QrCode, ShieldCheck, PanelsTopLeft } from "lucide-react";

const items = [
  { icon: QrCode, label: "QR check-in/out", desc: "Fast, reliable attendance" },
  { icon: CalendarCheck, label: "Google Calendar", desc: "Sync for students + families" },
  { icon: PanelsTopLeft, label: "Org tools", desc: "Rosters, docs, certificates" },
  { icon: ShieldCheck, label: "COPPA & privacy", desc: "Built for schools" },
];

export default function TrustBand() {
  return (
    <section className="py-6 sm:py-8">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => (
            <div
              key={it.label}
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/70 px-4 py-3 shadow-sm"
            >
              <span className="rounded-md bg-primary/10 p-2 text-primary">
                <it.icon className="h-4 w-4" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-foreground">{it.label}</p>
                <p className="text-xs text-muted-foreground">{it.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
