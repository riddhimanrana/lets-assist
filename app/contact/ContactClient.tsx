"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  BarChart3,
  Building2,
  Bug,
  FileSpreadsheet,
  Lightbulb,
  Mail,
  Plug,
  type LucideIcon,
} from "lucide-react";

import { ArrowRightIcon, useAnimatedIcon } from "@/components/icons/animated";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { Button } from "@/components/ui/button";
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

type ContactAction = {
  title: string;
  description: string;
  buttonLabel: string;
  icon: LucideIcon;
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
  const contactIcon = useAnimatedIcon();
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

  const contactActions: ContactAction[] = [
    {
      title: "Need help?",
      description:
        "For account, signup, certificate, or platform support, reach out and we’ll guide you from there.",
      buttonLabel: "Contact support",
      icon: Mail,
      href: "mailto:support@lets-assist.com",
    },
    {
      title: "Found a bug?",
      description:
        "Spotted a glitch or broken flow? Report it so we can investigate and patch it quickly.",
      buttonLabel: "Report bug",
      icon: Bug,
      onClick: handleReportBug,
    },
    {
      title: "Have a cool feature idea?",
      description:
        "Share product ideas and improvements that can make Let’s Assist more useful for everyone.",
      buttonLabel: "Suggest feature",
      icon: Lightbulb,
      onClick: handleSuggestFeature,
    },
    {
      title: "Setting up an organization?",
      description:
        "For schools, clubs, troops, nonprofits, and local teams that need rollout help or integrations.",
      buttonLabel: "Talk to our team",
      icon: Building2,
      organizationDialog: true,
    },
  ];

  return (
    <>
      <Dialog
        open={organizationDialogOpen}
        onOpenChange={setOrganizationDialogOpen}
      >
        <main className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-8 sm:px-6 md:py-12">
          <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-16">
            <div className="grid content-start gap-6">
              <div className="grid gap-3">
                <p className="text-muted-foreground text-sm font-medium">
                  For organizations
                </p>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Talk to our team.
                </h1>
                <p className="text-muted-foreground max-w-prose text-base leading-7">
                  We help schools, nonprofits, troops, clubs, and community
                  programs move from scattered forms and spreadsheets into one
                  volunteer workflow. Tell us what you already use and what
                  needs to connect.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <DialogTrigger
                  render={
                    <Button {...contactIcon.triggerProps}>
                      Contact us
                      <ArrowRightIcon
                        ref={contactIcon.ref}
                        size={16}
                        data-icon="inline-end"
                        aria-hidden="true"
                      />
                    </Button>
                  }
                />
                <Button asChild variant="outline">
                  <Link href="/organization/create">
                    Create an organization
                  </Link>
                </Button>
              </div>

              <div className="grid gap-4 border-t pt-6">
                <p className="text-muted-foreground text-sm">
                  Trusted by organizations like
                </p>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                  {trustedOrganizations.map((organization) => (
                    <div
                      key={organization.name}
                      className="flex min-h-11 items-center"
                    >
                      {organization.logo ? (
                        <Image
                          src={organization.logo}
                          alt={organization.name}
                          width={132}
                          height={52}
                          className="max-h-10 w-auto object-contain opacity-70 grayscale"
                        />
                      ) : (
                        <span className="text-muted-foreground text-sm font-medium">
                          {organization.name}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <ul className="grid content-start gap-6">
              {organizationServices.map((service) => (
                <li key={service.title} className="flex gap-3">
                  <service.icon
                    className="text-muted-foreground mt-1 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <div className="grid gap-1">
                    <h2 className="font-medium">{service.title}</h2>
                    <p className="text-muted-foreground text-sm leading-6">
                      {service.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-4">
            <h2 className="text-lg font-semibold tracking-tight">
              Other ways to reach us
            </h2>
            <ul className="divide-y border-y">
              {contactActions.map((action) => {
                const Icon = action.icon;
                const actionButton = action.organizationDialog ? (
                  <DialogTrigger
                    render={
                      <Button variant="outline">{action.buttonLabel}</Button>
                    }
                  />
                ) : action.href ? (
                  <Button asChild variant="outline">
                    <Link href={action.href}>{action.buttonLabel}</Link>
                  </Button>
                ) : (
                  <Button variant="outline" onClick={action.onClick}>
                    {action.buttonLabel}
                  </Button>
                );

                return (
                  <li
                    key={action.title}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-6"
                  >
                    <div className="flex min-w-0 flex-1 gap-3">
                      <Icon
                        className="text-muted-foreground mt-1 size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <div className="grid gap-1">
                        <h3 className="font-medium">{action.title}</h3>
                        <p className="text-muted-foreground max-w-prose text-sm leading-6">
                          {action.description}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 pl-7 sm:pl-0">{actionButton}</div>
                  </li>
                );
              })}
            </ul>
          </section>
        </main>

        <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Tell us about your organization</DialogTitle>
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
              <Button type="submit">Submit</Button>
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
