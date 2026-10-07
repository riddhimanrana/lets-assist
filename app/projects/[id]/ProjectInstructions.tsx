"use client";

import { useEffect, useState } from "react";
import { ChevronRight, HelpCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";
import {
  getCheckInGuide,
  getCreatorGuide,
  getProjectTypeGuide,
  getSignupSteps,
  type InstructionGuide,
  type InstructionStep,
  type InstructionTopic,
} from "./project-instructions-content";

interface ProjectInstructionsModalProps {
  project: Project;
  isCreator?: boolean;
  buttonClassName?: string;
  buttonVariant?:
    "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  buttonSize?:
    "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
  showChevron?: boolean;
}

function Steps({ steps }: { steps: InstructionStep[] }) {
  return (
    <ol className="grid gap-4">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <span className="text-muted-foreground w-4 shrink-0 text-sm font-medium tabular-nums">
            {index + 1}
          </span>
          <div className="grid gap-0.5">
            <p className="text-sm font-medium">{step.title}</p>
            <p className="text-muted-foreground text-sm">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Topics({ topics }: { topics: InstructionTopic[] }) {
  return (
    <div className="divide-y border-t">
      {topics.map((topic) => (
        <section key={topic.title} className="grid gap-2 py-4 last:pb-0">
          <h3 className="text-sm font-medium">{topic.title}</h3>
          {topic.paragraphs?.map((paragraph) => (
            <p key={paragraph} className="text-muted-foreground text-sm">
              {paragraph}
            </p>
          ))}
          {topic.bullets ? (
            <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-sm">
              {topic.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
          {topic.footnote ? (
            <p className="text-muted-foreground text-sm">{topic.footnote}</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function Guide({
  guide,
  showLabel = true,
}: {
  guide: InstructionGuide;
  showLabel?: boolean;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        {showLabel ? <Badge variant="outline">{guide.label}</Badge> : null}
        {guide.title ? (
          <h3 className="pt-1 text-base font-medium">{guide.title}</h3>
        ) : null}
        <p className="text-muted-foreground text-sm">{guide.intro}</p>
      </div>
      {guide.steps ? <Steps steps={guide.steps} /> : null}
      {guide.topics ? <Topics topics={guide.topics} /> : null}
    </div>
  );
}

export default function ProjectInstructionsModal({
  project,
  isCreator = false,
  buttonClassName,
  buttonVariant,
  buttonSize,
  showChevron,
}: ProjectInstructionsModalProps) {
  const [open, setOpen] = useState(false);
  const { event_type, verification_method } = project;
  const size = buttonSize ?? "default";
  const variant = buttonVariant ?? "outline";

  const getActiveTab = (): string => {
    if (isCreator) return "overview";
    if (verification_method === "qr-code") return "check-in";
    if (verification_method === "signup-only") return "signup";
    return "overview";
  };

  const [activeTab, setActiveTab] = useState<string>(getActiveTab());

  useEffect(() => {
    setActiveTab(getActiveTab());
  }, [isCreator, verification_method]);

  const title = isCreator ? "Creator guide" : "How it works";
  const typeGuide = getProjectTypeGuide(event_type);
  const checkInGuide = getCheckInGuide(verification_method);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        nativeButton={true}
        render={
          <Button
            variant={variant}
            size={size}
            className={cn(showChevron && "justify-between", buttonClassName)}
          >
            <HelpCircle data-icon="inline-start" aria-hidden="true" />
            {title}
            {showChevron && (
              <ChevronRight
                data-icon="inline-end"
                className="text-muted-foreground ml-auto"
                aria-hidden="true"
              />
            )}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {isCreator ? (
            <DialogDescription>
              {getCreatorGuide(event_type, verification_method).intro}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {isCreator ? (
          <Topics
            topics={
              getCreatorGuide(event_type, verification_method).topics ?? []
            }
          />
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
              <TabsTrigger value="check-in">
                {verification_method === "signup-only"
                  ? "Attending"
                  : "Check-in"}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4">
              {typeGuide ? (
                <Guide guide={typeGuide} />
              ) : (
                <p className="text-sm">
                  No specific instructions available for this project type.
                </p>
              )}
            </TabsContent>

            <TabsContent value="signup" className="pt-4">
              <div className="grid gap-4">
                <div className="grid gap-1">
                  <h3 className="text-base font-medium">How to sign up</h3>
                  <p className="text-muted-foreground text-sm">
                    Follow these steps to sign up for this volunteer
                    opportunity:
                  </p>
                </div>
                <Steps
                  steps={getSignupSteps(event_type, verification_method)}
                />
              </div>
            </TabsContent>

            <TabsContent value="check-in" className="pt-4">
              {checkInGuide ? (
                <Guide guide={checkInGuide} />
              ) : (
                <p className="text-sm">
                  No specific check-in instructions available.
                </p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
