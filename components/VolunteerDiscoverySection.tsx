"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarDays, MapPinned, Users } from "lucide-react";

const opportunities = [
  {
    title: "Sunset Beach Cleanup",
    organization: "Ocean Conservancy SF",
    location: "Outer Sunset, San Francisco",
    time: "Saturday • 9:00 AM",
    spots: 18,
    tags: ["Environmental", "Beach", "Outdoor"],
  },
  {
    title: "Mission District Pantry",
    organization: "SF-Marin Food Bank",
    location: "Mission, San Francisco",
    time: "Wednesday • 4:30 PM",
    spots: 12,
    tags: ["Food Security", "Spanish-friendly"],
  },
  {
    title: "STEM Night Mentors",
    organization: "Oakland Tech PTSA",
    location: "Oakland Tech Auditorium",
    time: "Friday • 5:00 PM",
    spots: 9,
    tags: ["STEM", "Mentorship", "On campus"],
  },
  {
    title: "Redwood Restoration",
    organization: "Peninsula Greenways",
    location: "Edgewood Park, San Mateo",
    time: "Sunday • 8:00 AM",
    spots: 22,
    tags: ["Environmental", "Trail work"],
  },
];

const filters = [
  "CSF eligible",
  "Transportation provided",
  "Weekend",
  "Service learning",
];

export const VolunteerDiscoverySection = () => {
  const [activeFilter, setActiveFilter] = useState("CSF eligible");

  return (
    <section className="relative overflow-hidden py-20">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background via-primary/5 to-background" />
      <div className="container relative mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-3xl text-center"
        >
          <Badge variant="outline" className="mb-4 inline-flex items-center gap-2 border-primary/40 bg-primary/10 text-primary">
            <MapPinned className="h-4 w-4" />
            Discover Opportunities
          </Badge>
          <h2 className="font-overusedgrotesk text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">
            A live feed of Bay Area service opportunities curated for students.
          </h2>
          <p className="mt-4 text-sm text-muted-foreground sm:text-base">
            Let&apos;s Assist surfaces new events the moment organizations publish them—auto-tagged for CSF, transportation requirements, and impact focus.
          </p>
        </motion.div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {filters.map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={cn(
                "rounded-full border px-4 py-2 text-xs uppercase tracking-[0.25em] transition",
                activeFilter === filter
                  ? "border-primary bg-primary text-primary-foreground shadow"
                  : "border-border/60 bg-background/70 text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {filter}
            </button>
          ))}
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {opportunities.map((opportunity, index) => (
            <motion.div
              key={opportunity.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.08 }}
              className="relative overflow-hidden rounded-[28px] border border-border/70 bg-background/85 p-6 shadow-[0_30px_80px_-50px_rgba(34,197,94,0.45)] backdrop-blur hover:border-primary/40"
            >
              <div className="pointer-events-none absolute -top-20 right-0 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-overusedgrotesk text-lg text-foreground">{opportunity.title}</p>
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">
                    {opportunity.organization}
                  </p>
                </div>
                <div className="rounded-full bg-primary/10 px-4 py-2 text-xs font-semibold text-primary">
                  {opportunity.spots} spots
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1 text-foreground">
                  <MapPinned className="h-4 w-4 text-primary" />
                  {opportunity.location}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  {opportunity.time}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {opportunity.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-6 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-muted-foreground/70">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  214 students watching
                </div>
                <Button variant="ghost" size="sm" className="text-xs">
                  View event
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
