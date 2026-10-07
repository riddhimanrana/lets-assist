"use client";

import Image from "next/image";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function AwardBadge() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Image
              src="/logos/congressional-app-challenge-cropped.svg"
              alt=""
              width={24}
              height={16}
              className="h-4 w-auto object-contain"
            />
            Special Recognition, 2025 Congressional App Challenge
          </button>
        }
      />
      <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto p-0 sm:max-w-3xl">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-lg bg-muted">
          <Image
            src="/images/congressional-recognition-certificate.jpeg"
            alt="Certificate of Special Congressional Recognition for the 2025 Congressional App Challenge"
            fill
            sizes="(min-width: 768px) 720px, 95vw"
            className="object-cover"
          />
        </div>
        <DialogHeader className="px-6 pb-6 text-left">
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            Congressional recognition
          </DialogTitle>
          <DialogDescription className="text-sm leading-6">
            Let&apos;s Assist received a Certificate of Special Congressional
            Recognition from Congressman Mark DeSaulnier for the 2025
            Congressional App Challenge. The recognition was presented to
            Riddhiman Rana for building software that helps communities
            coordinate volunteering, signups, and service records.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
