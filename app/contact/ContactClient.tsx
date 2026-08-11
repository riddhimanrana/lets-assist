"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Bug,
  FileSpreadsheet,
  Lightbulb,
  Mail,
  Plug,
  type LucideIcon,
} from "lucide-react";

import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type ContactActionCard = {
  title: string;
  description: string;
  buttonLabel: string;
  icon: LucideIcon;
  iconClassName: string;
  hoverClassName: string;
  buttonVariant?:
    "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  buttonClassName?: string;
  href?: string;
  onClick?: () => void;
  organizationDialog?: boolean;
};

const trustedOrganizations = [
  { name: "DVHigh CSF", logo: "/logos/dvhigh-csf.png" },
  { name: "Troop 941", logo: "/logos/troop941.png" },
  { name: "Dougherty Valley High School", logo: "/logos/dvhs.png" },
  { name: "Windemere Ranch Middle School", logo: "/logos/wrms.png" },
];

const organizationServices = [
  {
    title: "Google Sheets + Calendar syncing",
    description:
      "Keep rosters, hours, signup data, volunteer slots, and reminders connected to the tools your team already uses.",
    icon: FileSpreadsheet,
  },
  {
    title: "Custom plugins",
    description:
      "Build around private workflows, imports, membership rules, approvals, and school-specific operations.",
    icon: Plug,
  },
  {
    title: "Analytics dashboards",
    description:
      "Track verified hours, member progress, project turnout, exports, and CSF-ready reporting from one view.",
    icon: BarChart3,
  },
];

export default function ContactClient() {
  const { user } = useAuth();
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [organizationDialogOpen, setOrganizationDialogOpen] = useState(false);
  const [estimatedVolunteers, setEstimatedVolunteers] = useState("");
  const [feedbackType, setFeedbackType] = useState<"issue" | "idea" | "other">(
    "issue",
  );

  const handleSuggestFeature = () => {
    if (!user) {
      toast.error("Authentication required", {
        description: "You need to be logged in to send feedback.",
      });
      return;
    }
    setFeedbackType("idea");
    setShowFeedbackDialog(true);
  };

  const handleReportBug = () => {
    if (!user) {
      toast.error("Authentication required", {
        description: "You need to be logged in to report a bug.",
      });
      return;
    }
    setFeedbackType("issue");
    setShowFeedbackDialog(true);
  };

  const handleOrganizationSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!estimatedVolunteers) {
      toast.error("Select an estimated monthly volunteer range.");
      return;
    }

    toast.success("Organization request ready.", {
      description:
        "Email contact@lets-assist.com with these details and we will follow up.",
    });
    setOrganizationDialogOpen(false);
    setEstimatedVolunteers("");
  };

  const actionCards: ContactActionCard[] = [
    {
      title: "Have a cool feature idea?",
      description:
        "Share product ideas and improvements that can make Let’s Assist more useful for everyone.",
      buttonLabel: "Suggest Feature",
      icon: Lightbulb,
      iconClassName: "border-primary/20 bg-primary/10 text-primary",
      hoverClassName: "hover:border-primary/30",
      buttonVariant: "default",
      onClick: handleSuggestFeature,
    },
    {
      title: "Found a bug?",
      description:
        "Spotted a glitch or broken flow? Report it so we can investigate and patch it quickly.",
      buttonLabel: "Report Bug",
      icon: Bug,
      iconClassName: "border-destructive/20 bg-destructive/10 text-destructive",
      hoverClassName: "hover:border-destructive/30",
      buttonVariant: "destructive",
      onClick: handleReportBug,
    },
    {
      title: "Need help?",
      description:
        "For account, signup, certificate, or platform support, reach out and we’ll guide you from there.",
      buttonLabel: "Contact Support",
      icon: Mail,
      iconClassName: "border-info/20 bg-info/10 text-info",
      hoverClassName: "hover:border-info/30",
      buttonClassName: "bg-info text-background hover:bg-info/90",
      href: "mailto:support@lets-assist.com",
    },
    {
      title: "Setting up an organization?",
      description:
        "For schools, clubs, troops, nonprofits, and local teams that need rollout help or integrations.",
      buttonLabel: "Talk to Our Team",
      icon: Building2,
      iconClassName: "border-chart-4/20 bg-chart-4/10 text-chart-4",
      hoverClassName: "hover:border-chart-4/30",
      buttonClassName: "bg-chart-4 text-background hover:bg-chart-4/90",
      organizationDialog: true,
    },
  ];

  return (
    <>
      <Dialog
        open={organizationDialogOpen}
        onOpenChange={setOrganizationDialogOpen}
      >
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 md:gap-10 md:py-12 lg:px-8">
          <section className="grid gap-8 rounded-3xl border bg-card p-6 md:p-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-primary">
                For organizations
              </p>
              <h2 className="font-nohemi mt-3 text-3xl font-medium tracking-normal md:text-5xl">
                Talk to our team.
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
                We help schools, nonprofits, troops, clubs, and community
                programs move from scattered forms and spreadsheets into one
                volunteer workflow. Tell us what you already use and what needs
                to connect.
              </p>

              <div className="mt-8 border-y py-5">
                <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                  Trusted by organizations like
                </p>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
                  {trustedOrganizations.map((organization) => (
                    <div
                      key={organization.name}
                      className="flex min-h-11 items-center justify-center"
                    >
                      {organization.logo ? (
                        <Image
                          src={organization.logo}
                          alt={organization.name}
                          width={132}
                          height={52}
                          className="max-h-11 w-auto object-contain opacity-65 grayscale transition hover:opacity-100 hover:grayscale-0"
                        />
                      ) : (
                        <span className="rounded-full border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground">
                          {organization.name}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <DialogTrigger
                  render={
                    <Button className="rounded-full">
                      Contact us
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  }
                />
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/organization/create">
                    Create an organization
                  </Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-3">
              {organizationServices.map((service) => (
                <div
                  key={service.title}
                  className="flex gap-4 rounded-xl border bg-background p-4"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <service.icon className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">{service.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {service.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {actionCards.map((card) => {
              const Icon = card.icon;
              const buttonClasses = cn(
                "w-full justify-between",
                card.buttonClassName,
              );
              const actionButton = card.organizationDialog ? (
                <DialogTrigger
                  render={
                    <Button
                      variant={card.buttonVariant ?? "default"}
                      className={buttonClasses}
                    >
                      {card.buttonLabel}
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  }
                />
              ) : card.href ? (
                <Button
                  asChild
                  variant={card.buttonVariant ?? "default"}
                  className={buttonClasses}
                >
                  <Link href={card.href}>
                    {card.buttonLabel}
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
              ) : (
                <Button
                  variant={card.buttonVariant ?? "default"}
                  className="w-full justify-between"
                  onClick={card.onClick}
                >
                  {card.buttonLabel}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              );

              return (
                <Card
                  key={card.title}
                  className={cn(
                    "group flex h-full flex-col overflow-hidden border border-border/70 bg-card/80 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
                    card.hoverClassName,
                  )}
                >
                  <CardHeader className="flex flex-col gap-4">
                    <div
                      className={cn(
                        "inline-flex size-12 items-center justify-center rounded-xl border",
                        card.iconClassName,
                      )}
                    >
                      <Icon className="size-5" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <CardTitle className="text-lg md:text-xl">
                        {card.title}
                      </CardTitle>
                      <CardDescription className="text-sm md:text-base">
                        {card.description}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="mt-auto pt-0">
                    {actionButton}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </main>

        <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-nohemi text-2xl font-medium tracking-normal">
              Tell us about your organization
            </DialogTitle>
            <DialogDescription>
              We&apos;ll use this to understand your volunteer workflow,
              expected scale, and any custom integrations you need.
            </DialogDescription>
          </DialogHeader>

          <form
            className="flex flex-col gap-5"
            onSubmit={handleOrganizationSubmit}
          >
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="organization-name">Name *</FieldLabel>
                  <Input
                    id="organization-name"
                    name="name"
                    autoComplete="name"
                    placeholder="Your full name"
                    required
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="organization-email">Email *</FieldLabel>
                  <Input
                    id="organization-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@organization.org"
                    required
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="organization-field">
                  Organization *
                </FieldLabel>
                <Input
                  id="organization-field"
                  name="organization"
                  autoComplete="organization"
                  placeholder="School, nonprofit, troop, club, or city program"
                  required
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="estimated-monthly-volunteers">
                  Estimated monthly volunteers *
                </FieldLabel>
                <Select
                  name="estimatedMonthlyVolunteers"
                  value={estimatedVolunteers}
                  onValueChange={(value) => setEstimatedVolunteers(value ?? "")}
                >
                  <SelectTrigger
                    id="estimated-monthly-volunteers"
                    aria-required="true"
                    className="w-full"
                  >
                    <SelectValue placeholder="Select a range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="under-25">Under 25</SelectItem>
                      <SelectItem value="25-100">25-100</SelectItem>
                      <SelectItem value="100-500">100-500</SelectItem>
                      <SelectItem value="500-plus">500+</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  A rough estimate is fine. This helps us recommend the right
                  setup.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="organization-use-case">
                  Tell us about your use case and if you need custom
                  integrations *
                </FieldLabel>
                <Textarea
                  id="organization-use-case"
                  name="useCase"
                  className="min-h-32"
                  placeholder="Tell us about signups, rosters, Sheets or Calendar sync, imports, waivers, plugins, approvals, or anything custom."
                  required
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="heard-about-us">
                  How did you hear about us?
                </FieldLabel>
                <Input
                  id="heard-about-us"
                  name="heardAboutUs"
                  placeholder="Friend, school, Google, event, social media..."
                />
              </Field>
            </FieldGroup>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOrganizationDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                Submit
                <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {showFeedbackDialog && (
        <FeedbackDialog
          onOpenChangeAction={setShowFeedbackDialog}
          initialType={feedbackType}
        />
      )}
    </>
  );
}
