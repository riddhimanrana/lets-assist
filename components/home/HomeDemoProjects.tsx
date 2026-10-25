"use client";

import {
  Bike,
  BookOpen,
  Droplets,
  Info,
  MapPin,
  PawPrint,
  Soup,
  Sprout,
  type LucideIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  HOME_DEMO_NO_SIGNUP_TEXT,
  HOME_DEMO_PROJECTS,
  type HomeDemoProject,
  type HomeDemoProjectIcon,
} from "./home-demo-data";

const PROJECT_ICONS: Record<HomeDemoProjectIcon, LucideIcon> = {
  creek: Droplets,
  bike: Bike,
  reading: BookOpen,
  meal: Soup,
  garden: Sprout,
  shelter: PawPrint,
};

/**
 * The body of a sample project preview. It is plain content with no links and
 * no actions, so nothing in it can lead to a real project or a signup.
 */
export function HomeDemoProjectDetails({
  project,
}: {
  project: HomeDemoProject;
}) {
  return (
    <div data-slot="home-demo-project-details" className="grid gap-4">
      <dl className="grid gap-3">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">When</dt>
          <dd>{project.schedule}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">Your role</dt>
          <dd>{project.role}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">What you would do</dt>
          <dd>
            <ul className="grid list-disc gap-1 pl-5">
              {project.tasks.map((task) => (
                <li key={task}>{task}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">What to bring</dt>
          <dd>{project.bring}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">Good for</dt>
          <dd>{project.goodFor}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">Fictional organizer</dt>
          <dd>{project.organizer}</dd>
        </div>
      </dl>
      <Alert variant="info" role="note">
        <Info aria-hidden="true" />
        <AlertTitle>{HOME_DEMO_NO_SIGNUP_TEXT}</AlertTitle>
        <AlertDescription>
          It is a made-up project that shows what a listing could look like.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function HomeDemoProjectCard({ project }: { project: HomeDemoProject }) {
  const Icon = PROJECT_ICONS[project.icon];
  const location = `${project.city}, ${project.state}`;

  return (
    <Card data-demo-project={project.id} className="h-full">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
            <Icon aria-hidden="true" className="text-muted-foreground size-5" />
          </div>
          <div className="grid min-w-0 gap-1">
            <CardTitle role="heading" aria-level={3} className="break-words">
              {project.title}
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <MapPin aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 break-words">{location}</span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid flex-1 content-start gap-3">
        <Badge variant="outline">Sample project</Badge>
        <div className="grid gap-1">
          <p className="font-medium">{project.role}</p>
          <p className="text-muted-foreground">{project.schedule}</p>
        </div>
        <p className="text-pretty">{project.summary}</p>
      </CardContent>
      <CardFooter>
        <Dialog>
          <DialogTrigger
            render={
              <Button
                variant="outline"
                aria-label={`Preview example: ${project.title} in ${project.city}`}
              >
                Preview example
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <Badge variant="outline">Sample project</Badge>
              <DialogTitle>{project.title}</DialogTitle>
              <DialogDescription>
                {project.place} in {location}. A fictional example.
              </DialogDescription>
            </DialogHeader>
            <HomeDemoProjectDetails project={project} />
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
}

/** Six fictional projects. Each card opens a preview and nothing else. */
export function HomeDemoProjects() {
  return (
    <ul
      data-slot="home-demo-projects"
      className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-4"
    >
      {HOME_DEMO_PROJECTS.map((project) => (
        <li key={project.id} className="min-w-0">
          <HomeDemoProjectCard project={project} />
        </li>
      ))}
    </ul>
  );
}
