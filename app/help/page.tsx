"use client";

import { useState, useMemo } from "react";
import { Search, X } from "lucide-react";

import { MessageCircleIcon } from "@/components/icons/animated";
import { PageHeader } from "@/components/layout/PageHeader";
import { AnimatedLinkButton } from "@/components/projects/AnimatedLinkButton";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Import section components
import { GettingStartedSection } from "./sections/getting-started";
import { ProjectsSection } from "./sections/projects";
import { OrganizationsSection } from "./sections/organizations";
import { SchoolsSection } from "./sections/schools";
import { CertificatesSection } from "./sections/certificates";
import { DataExportSection } from "./sections/data-export";

// Comprehensive search index for all help content
const searchIndex = [
  // Getting Started
  {
    id: "getting-started-welcome",
    title: "Welcome to Let's Assist",
    category: "getting-started",
    content:
      "welcome lets assist complete guide tracking volunteer hours managing projects quick start create account profile browse create project track volunteer hours dashboard certificates organizations",
    section: "Welcome",
  },
  {
    id: "getting-started-account",
    title: "Setting Up Your Account",
    category: "getting-started",
    content:
      "account setup profile full name contact information upload picture avatar time zone notification preferences connect organizations settings dashboard",
    section: "Account Setup",
  },
  {
    id: "getting-started-navigation",
    title: "Navigating the Platform",
    category: "getting-started",
    content:
      "navigation platform home dashboard projects organizations certificates quick actions create new projects settings profile menu export data main sections",
    section: "Navigation",
  },
  {
    id: "getting-started-first-steps",
    title: "Your First Volunteer Project",
    category: "getting-started",
    content:
      "first volunteer project join organization create individual project import existing hours csv upload manual tracking",
    section: "First Steps",
  },

  // Projects
  {
    id: "projects-creating",
    title: "Creating Projects",
    category: "projects",
    content:
      "create new project project name description start end dates category team members hour tracking preferences individual team organization event ongoing location invite",
    section: "Project Creation",
  },
  {
    id: "projects-tracking",
    title: "Hour Tracking Methods",
    category: "projects",
    content:
      "tracking hours live timer start stop manual entry bulk import upload spreadsheet verification project supervisors organization coordinators automatic verification",
    section: "Hour Tracking",
  },
  {
    id: "projects-certificates",
    title: "Earning Certificates",
    category: "projects",
    content:
      "earning certificates digital certificate project details hour totals verification status downloadable pdf shareable links verification automatic generation",
    section: "Certificates",
  },
  {
    id: "projects-csv",
    title: "CSV Export & Import",
    category: "projects",
    content:
      "csv export import data reports school requirements dashboard export data date range format pdf download existing records upload map columns spreadsheet",
    section: "Data Management",
  },
  {
    id: "projects-management",
    title: "Managing Projects",
    category: "projects",
    content:
      "managing projects project status planning active completed cancelled edit details add remove team members update status participant statistics export project data",
    section: "Project Management",
  },

  // Organizations
  {
    id: "organizations-volunteers",
    title: "Joining Organizations",
    category: "organizations",
    content:
      "joining organizations browse available request join invitation code approval organization admin participating organization projects browse organizations page",
    section: "For Volunteers",
  },
  {
    id: "organizations-benefits",
    title: "Organization Project Benefits",
    category: "organizations",
    content:
      "organization projects volunteer opportunities team projects automatic hour verification organization admins resources guidelines higher credibility networking verified organizations",
    section: "Organization Features",
  },
  {
    id: "organizations-roles",
    title: "Organization Roles",
    category: "organizations",
    content:
      "organization roles member staff admin permissions participate projects create projects verify hours full organization management member oversight",
    section: "Roles & Permissions",
  },
  {
    id: "organizations-admins",
    title: "Creating & Managing Organizations",
    category: "organizations",
    content:
      "creating organizations apply organization account details verification projects volunteer opportunities invite volunteers manage volunteers review approve applications verify hours admin tools",
    section: "For Admins",
  },
  {
    id: "organization-data-management",
    title: "Organization Data Export",
    category: "organizations",
    content:
      "export member data organization admin staff member hours participation csv download member details individual reports member management analytics",
    section: "Data Management",
  },
  {
    id: "organization-verification",
    title: "Organization Verification & Badges",
    category: "organizations",
    content:
      "organization verification trust badges verified organization benefits higher trust enhanced visibility official verification badge blue check badge priority search results apply verification credibility certificates academic requirements project listings",
    section: "Verification",
  },

  // Schools & CSF
  {
    id: "schools-csf",
    title: "Chapter CSF Workspaces",
    category: "schools",
    content:
      "california scholarship federation chapter workspace member officer role help class links student links membership applications policy deadlines account connections",
    section: "CSF & Schools",
  },
  {
    id: "schools-students",
    title: "CSF Member Workflow",
    category: "schools",
    content:
      "connect student record verified account my csf membership status activities signups point submissions proof officer review class feed",
    section: "Student Guide",
  },
  {
    id: "schools-projects",
    title: "CSF Activities and Point Claims",
    category: "schools",
    content:
      "approved activities signups schedule location point type service proof returned claim verification chapter published policy",
    section: "Approved Activities",
  },
  {
    id: "schools-setup",
    title: "CSF Chapter Setup",
    category: "schools",
    content:
      "semester setup applications imports google sheets members account connections staff access officer positions class posts meetings communications reports change history",
    section: "School Administration",
  },

  // Certificates
  {
    id: "certificates-understanding",
    title: "Understanding Certificates",
    category: "certificates",
    content:
      "understanding certificates digital proof volunteer work automatically generated completing projects shareable links downloadable verification",
    section: "Certificate Basics",
  },
  {
    id: "certificates-viewing",
    title: "Viewing Your Certificates",
    category: "certificates",
    content:
      "viewing certificates certificates page dashboard access browse grid view filter date organization project sort newest oldest hours",
    section: "Viewing Certificates",
  },
  {
    id: "certificates-sharing",
    title: "Sharing & Verification",
    category: "certificates",
    content:
      "sharing verification direct links pdf downloads print options unique url schools employers scholarship committees verification qr codes",
    section: "Sharing Certificates",
  },
  {
    id: "certificates-export",
    title: "Exporting Certificate Data",
    category: "certificates",
    content:
      "exporting certificate data dashboard certificates page csv export date range filter print bulk print summary data reporting",
    section: "Data Export",
  },

  // Data Export
  {
    id: "data-export-personal",
    title: "Personal Data Exports",
    category: "data-export",
    content:
      "personal data exports certificate export dashboard date range filtering csv download comprehensive data volunteer certificates hour tracking project participation",
    section: "Personal Exports",
  },
  {
    id: "data-export-organization",
    title: "Organization Data Exports",
    category: "data-export",
    content:
      "organization data exports member hours export admin staff permissions member details individual reports organization page members tab csv download",
    section: "Organization Exports",
  },
  {
    id: "data-export-analytics",
    title: "Analytics & Insights",
    category: "data-export",
    content:
      "analytics insights personal dashboard analytics organization analytics member engagement statistics project participation rates total organizational impact trends",
    section: "Analytics",
  },
];

export default function HelpPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTab, setSelectedTab] = useState("getting-started");
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Filter search results based on query
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();
    return searchIndex
      .filter(
        (item) =>
          item.title.toLowerCase().includes(query) ||
          item.content.toLowerCase().includes(query) ||
          item.section.toLowerCase().includes(query),
      )
      .slice(0, 8); // Limit to 8 results
  }, [searchQuery]);

  const handleSearchSelect = (item: (typeof searchIndex)[0]) => {
    setSelectedTab(item.category);
    setSearchQuery("");
    setShowSearchResults(false);

    // Scroll to the section after a brief delay to allow tab change
    setTimeout(() => {
      const element = document.getElementById(item.id);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  };

  const clearSearch = () => {
    setSearchQuery("");
    setShowSearchResults(false);
  };

  const tabs = [
    { value: "getting-started", label: "Getting started" },
    { value: "projects", label: "Projects" },
    { value: "organizations", label: "Organizations" },
    { value: "schools", label: "Schools & CSF" },
    { value: "certificates", label: "Certificates" },
    { value: "data-export", label: "Data export" },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Help center"
        description="Everything you need to know about using Let's Assist for volunteer hour tracking, project management, and certificate generation."
      />

      {/* Search Section */}
      <div className="relative mt-6 max-w-xl">
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search help articles"
            placeholder="Search help articles, such as “export member data”"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSearchResults(e.target.value.length > 0);
            }}
          />
          {searchQuery && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear search"
                onClick={clearSearch}
              >
                <X aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>

        {/* Search Results Dropdown */}
        {showSearchResults && searchResults.length > 0 && (
          <div className="bg-popover text-popover-foreground absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-lg border shadow-md">
            <Command>
              <CommandList className="max-h-72">
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup>
                  {searchResults.map((item) => (
                    <CommandItem
                      key={item.id}
                      onSelect={() => handleSearchSelect(item)}
                      className="cursor-pointer"
                    >
                      <div className="flex w-full items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {item.title}
                          </div>
                          <div className="text-muted-foreground truncate text-sm">
                            {item.section}
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {item.category.replace("-", " ")}
                        </Badge>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        )}

        {/* No Results Message */}
        {showSearchResults && searchQuery && searchResults.length === 0 && (
          <div className="bg-popover text-popover-foreground absolute inset-x-0 top-full z-50 mt-2 grid gap-1 rounded-lg border p-4 text-sm shadow-md">
            <p>No results found for &quot;{searchQuery}&quot;</p>
            <p className="text-muted-foreground">
              Try searching for terms like &quot;export&quot;, &quot;CSF&quot;,
              &quot;certificates&quot;, or &quot;organizations&quot;
            </p>
          </div>
        )}
      </div>

      <Tabs
        value={selectedTab}
        onValueChange={(val) => val && setSelectedTab(val)}
        className="mt-8 w-full gap-6"
      >
        <TabsList variant="line" className="border-b">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex-none px-3"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="getting-started" className="space-y-6">
          <GettingStartedSection />
        </TabsContent>

        <TabsContent value="projects" className="space-y-6">
          <ProjectsSection />
        </TabsContent>

        <TabsContent value="organizations" className="space-y-6">
          <OrganizationsSection />
        </TabsContent>

        <TabsContent value="schools" className="space-y-6">
          <SchoolsSection />
        </TabsContent>

        <TabsContent value="certificates" className="space-y-6">
          <CertificatesSection />
        </TabsContent>

        <TabsContent value="data-export" className="space-y-6">
          <DataExportSection />
        </TabsContent>
      </Tabs>

      <section className="mt-12 flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <h2 className="font-medium">Still need help?</h2>
          <p className="text-muted-foreground text-sm">
            Can&apos;t find what you&apos;re looking for? We&apos;re here to
            help!
          </p>
        </div>
        <AnimatedLinkButton
          href="/contact"
          icon={MessageCircleIcon}
          className="shrink-0"
        >
          Contact support
        </AnimatedLinkButton>
      </section>
    </div>
  );
}
