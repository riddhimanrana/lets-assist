"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Building2, LogIn, UserPlus, ArrowRight, ShieldCheck, Sparkles, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

interface AuthDialogProps {
  organization: {
    name: string;
    username: string;
    logo_url: string | null;
  };
  joinCode: string;
}

export default function AuthDialog({ organization, joinCode }: AuthDialogProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="w-full max-w-[440px] mx-auto px-4"
    >
      <Card className="border-none shadow-[0_20px_50px_rgba(0,0,0,0.1)] overflow-hidden rounded-[2.5rem] bg-background/80 backdrop-blur-xl">
        <div className="h-2 w-full bg-gradient-to-r from-primary/20 via-primary to-primary/20" />

        <CardHeader className="text-center pt-12 pb-6 px-8">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="flex justify-center mb-8"
          >
            <div className="relative group">
              <div className="absolute inset-0 bg-primary/20 rounded-[2rem] blur-2xl group-hover:bg-primary/30 transition-all duration-500" />
              <div className="relative">
                <Avatar className="h-28 w-28 ring-8 ring-background/50 shadow-2xl relative z-10 rounded-[2.2rem] overflow-hidden">
                  <AvatarImage src={organization.logo_url || undefined} className="object-cover" />
                  <AvatarFallback className="bg-gradient-to-br from-primary/10 to-primary/5 text-primary rounded-[2.2rem]">
                    <Building2 className="h-12 w-12" />
                  </AvatarFallback>
                </Avatar>
                <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.4, type: "spring" }}
                  className="absolute -bottom-2 -right-2 bg-emerald-500 text-white p-2 rounded-2xl shadow-xl z-20 border-4 border-background"
                >
                  <ShieldCheck className="size-5" />
                </motion.div>
              </div>
            </div>
          </motion.div>

          <div className="space-y-3">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <CardTitle className="text-3xl font-black tracking-tight leading-tight bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/70">
                Join {organization.name}
              </CardTitle>
            </motion.div>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-muted-foreground font-medium text-balance px-4"
            >
              You've been invited to join this community. Sign in or create an account to get started.
            </motion.p>
          </div>
        </CardHeader>

        <CardContent className="space-y-8 pb-12 px-10">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="grid gap-4"
          >
            <Button
              asChild
              className="w-full h-14 text-base font-bold rounded-2xl group relative overflow-hidden shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all active:scale-[0.98]"
            >
              <Link href={`/login?redirect=/organization/join?code=${joinCode}`}>
                <div className="relative z-10 flex items-center justify-center w-full">
                  <LogIn className="h-5 w-5 mr-3 group-hover:translate-x-0.5 transition-transform" />
                  Sign In to Join
                  <ArrowRight className="h-4 w-4 ml-auto opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                </div>
              </Link>
            </Button>

            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/50" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground/40">
                <span className="bg-background/80 backdrop-blur-sm px-4">
                  or if you're new here
                </span>
              </div>
            </div>

            <Button
              variant="outline"
              asChild
              className="w-full h-14 text-base font-bold rounded-2xl border-2 border-primary/10 hover:bg-primary/5 hover:border-primary/20 transition-all group active:scale-[0.98]"
            >
              <Link href={`/signup?redirect=/organization/join?code=${joinCode}`}>
                <UserPlus className="h-5 w-5 mr-3 text-primary/70" />
                Create Account
                <Sparkles className="h-4 w-4 ml-auto text-primary/40 group-hover:text-primary group-hover:rotate-12 transition-all duration-300" />
              </Link>
            </Button>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="p-5 rounded-3xl bg-primary/5 border border-primary/10 flex gap-4 items-start relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-1">
              <Sparkles className="size-12 text-primary/5 -rotate-12" />
            </div>
            <div className="p-2 rounded-xl bg-background border shadow-sm shrink-0 mt-0.5">
              <CheckCircle2 className="size-4 text-primary" />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground/80 font-medium">
              By joining, you'll gain access to private tournaments, roster management tools, and member-only resources.
            </p>
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
