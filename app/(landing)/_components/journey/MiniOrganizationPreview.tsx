"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { Building2, BadgeCheck, Users, Clock } from "lucide-react";
import { motion } from "framer-motion";

interface Member {
  name: string;
  avatar?: string | null;
  verifiedHours: number;
}

interface MiniOrganizationPreviewProps {
  name: string;
  verified?: boolean;
  members: Member[];
}

export function MiniOrganizationPreview({ name, verified = true, members }: MiniOrganizationPreviewProps) {
  const top3 = members.slice(0, 3);
  const totalHours = members.reduce((sum, m) => sum + m.verifiedHours, 0);

  return (
    <Card className="border-border/60 bg-background/80">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" />
            </div>
            <CardTitle className="text-base font-semibold">{name}</CardTitle>
            {verified && (
              <Badge variant="secondary" className="gap-1 bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20">
                <BadgeCheck className="h-3 w-3" /> Verified
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> {members.length} members
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Top members */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {top3.map((m, i) => (
            <motion.div
              key={m.name}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="rounded-md border border-border/60 p-3 bg-card"
            >
              <div className="flex items-center gap-2 mb-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={m.avatar || undefined} />
                  <AvatarFallback>
                    <NoAvatar fullName={m.name} />
                  </AvatarFallback>
                </Avatar>
                <p className="text-xs font-medium truncate">{m.name}</p>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3 text-primary" />
                <span className="font-semibold text-foreground">{m.verifiedHours}h</span> verified
              </div>
            </motion.div>
          ))}
        </div>

        {/* Totals */}
        <div className="rounded-md border border-border/60 p-3 bg-card flex items-center justify-between">
          <div className="text-xs text-muted-foreground">Total verified hours</div>
          <div className="text-sm font-bold">
            {totalHours.toFixed(1)}h
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
