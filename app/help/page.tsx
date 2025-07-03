"use client";

import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Search, X, HelpCircle } from "lucide-react";
import Link from "next/link";

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
    content: "welcome lets assist complete guide tracking volunteer hours managing projects quick start create account profile browse create project track volunteer hours dashboard certificates organizations",
    section: "Welcome"
  },
  {
    id: "getting-started-account",
    title: "Setting Up Your Account",
    category: "getting-started", 
    content: "account setup profile full name contact information upload picture avatar time zone notification preferences connect organizations settings dashboard",
    section: "Account Setup"
  },
  {
    id: "getting-started-navigation",
    title: "Navigating the Platform",
    category: "getting-started",
    content: "navigation platform home dashboard projects organizations certificates quick actions create new projects settings profile menu export data main sections",
    section: "Navigation"
  },
  {
    id: "getting-started-first-steps",
    title: "Your First Volunteer Project",
    category: "getting-started",
    content: "first volunteer project join organization create individual project import existing hours csv upload manual tracking",
    section: "First Steps"
  },

  // Projects
  {
    id: "projects-creating",
    title: "Creating Projects",
    category: "projects",
    content: "create new project project name description start end dates category team members hour tracking preferences individual team organization event ongoing location invite",
    section: "Project Creation"
  },
  {
    id: "projects-tracking",
    title: "Hour Tracking Methods",
    category: "projects",
    content: "tracking hours live timer start stop manual entry bulk import upload spreadsheet verification project supervisors organization coordinators automatic verification",
    section: "Hour Tracking"
  },
  {
    id: "projects-certificates",
    title: "Earning Certificates",
    category: "projects",
    content: "earning certificates digital certificate project details hour totals verification status downloadable pdf shareable links verification automatic generation",
    section: "Certificates"
  },
  {
    id: "projects-csv",
    title: "CSV Export & Import",
    category: "projects",
    content: "csv export import data reports school requirements dashboard export data date range format pdf download existing records upload map columns spreadsheet",
    section: "Data Management"
  },
  {
    id: "projects-management",
    title: "Managing Projects",
    category: "projects",
    content: "managing projects project status planning active completed cancelled edit details add remove team members update status participant statistics export project data",
    section: "Project Management"
  },

  // Organizations
  {
    id: "organizations-volunteers",
    title: "Joining Organizations",
    category: "organizations",
    content: "joining organizations browse available request join invitation code approval organization admin participating organization projects browse organizations page",
    section: "For Volunteers"
  },
  {
    id: "organizations-benefits",
    title: "Organization Project Benefits",
    category: "organizations",
    content: "organization projects volunteer opportunities team projects automatic hour verification organization admins resources guidelines higher credibility networking verified organizations",
    section: "Organization Features"
  },
  {
    id: "organizations-roles",
    title: "Organization Roles",
    category: "organizations",
    content: "organization roles member staff admin permissions participate projects create projects verify hours full organization management member oversight",
    section: "Roles & Permissions"
  },
  {
    id: "organizations-admins",
    title: "Creating & Managing Organizations",
    category: "organizations",
    content: "creating organizations apply organization account details verification projects volunteer opportunities invite volunteers manage volunteers review approve applications verify hours admin tools",
    section: "For Admins"
  },
  {
    id: "organization-data-management",
    title: "Organization Data Export",
    category: "organizations",
    content: "export member data organization admin staff member hours participation csv download member details individual reports member management analytics",
    section: "Data Management"
  },
  {
    id: "organization-verification",
    title: "Organization Verification",
    category: "organizations",
    content: "organization verification trust badges verified organization benefits higher trust enhanced visibility official verification badge priority search results apply verification",
    section: "Verification"
  },

  // Schools & CSF
  {
    id: "schools-csf",
    title: "CSF Programs",
    category: "schools",
    content: "california scholarship federation csf volunteer hours school programs csf requirements membership verification reporting students track hours csf compliant documentation supervisor verification export reports",
    section: "CSF & Schools"
  },
  {
    id: "schools-students",
    title: "CSF Hour Tracking",
    category: "schools", 
    content: "csf hour tracking school approved projects csf eligible volunteer work tutoring students school events community clean up library nonprofit senior center activities csf documentation",
    section: "Student Guide"
  },
  {
    id: "schools-projects",
    title: "School-Approved Projects",
    category: "schools",
    content: "school approved projects csf eligible tutoring school events community cleanup library help senior center food banks animal shelters hospital volunteer",
    section: "Approved Activities"
  },
  {
    id: "schools-setup",
    title: "School Program Setup",
    category: "schools",
    content: "school program setup school organization account csf volunteer program requirements invite students monitor progress verify hours dashboard student progress automated alerts bulk export school records",
    section: "School Administration"
  },

  // Certificates
  {
    id: "certificates-understanding",
    title: "Understanding Certificates",
    category: "certificates",
    content: "understanding certificates digital proof volunteer work automatically generated completing projects shareable links downloadable verification",
    section: "Certificate Basics"
  },
  {
    id: "certificates-viewing",
    title: "Viewing Your Certificates",
    category: "certificates",
    content: "viewing certificates certificates page dashboard access browse grid view filter date organization project sort newest oldest hours",
    section: "Viewing Certificates"
  },
  {
    id: "certificates-sharing",
    title: "Sharing & Verification",
    category: "certificates",
    content: "sharing verification direct links pdf downloads print options unique url schools employers scholarship committees verification qr codes",
    section: "Sharing Certificates"
  },
  {
    id: "certificates-export",
    title: "Exporting Certificate Data",
    category: "certificates",
    content: "exporting certificate data dashboard certificates page csv export date range filter print bulk print summary data reporting",
    section: "Data Export"
  },

  // Data Export
  {
    id: "data-export-personal",
    title: "Personal Data Exports",
    category: "data-export",
    content: "personal data exports certificate export dashboard date range filtering csv download comprehensive data volunteer certificates hour tracking project participation",
    section: "Personal Exports"
  },
  {
    id: "data-export-organization",
    title: "Organization Data Exports",
    category: "data-export",
    content: "organization data exports member hours export admin staff permissions member details individual reports organization page members tab csv download",
    section: "Organization Exports"
  },
  {
    id: "data-export-analytics",
    title: "Analytics & Insights",
    category: "data-export",
    content: "analytics insights personal dashboard analytics organization analytics member engagement statistics project participation rates total organizational impact trends",
    section: "Analytics"
  }
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
      .filter(item => 
        item.title.toLowerCase().includes(query) ||
        item.content.toLowerCase().includes(query) ||
        item.section.toLowerCase().includes(query)
      )
      .slice(0, 8); // Limit to 8 results
  }, [searchQuery]);

  const handleSearchSelect = (item: typeof searchIndex[0]) => {
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

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4">Help Center</h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Everything you need to know about using Let&apos;s Assist for volunteer hour tracking, project management, and certificate generation.
        </p>
      </div>

      {/* Search Section */}
      <div className="mb-8 relative">
        <div className="relative max-w-2xl mx-auto">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search help articles... (e.g., 'export member data', 'CSF hours', 'certificates')"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSearchResults(e.target.value.length > 0);
            }}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSearch}
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        {/* Search Results Dropdown */}
        {showSearchResults && searchResults.length > 0 && (
          <Card className="absolute top-full mt-2 w-full max-w-2xl mx-auto left-1/2 transform -translate-x-1/2 z-50 shadow-lg">
            <CardContent className="p-0">
              <Command>
                <CommandList className="max-h-60">
                  <CommandEmpty>No results found.</CommandEmpty>
                  <CommandGroup>
                    {searchResults.map((item) => (
                      <CommandItem
                        key={item.id}
                        onSelect={() => handleSearchSelect(item)}
                        className="cursor-pointer"
                      >
                        <div className="flex items-center justify-between w-full">
                          <div>
                            <div className="font-medium">{item.title}</div>
                            <div className="text-sm text-muted-foreground">{item.section}</div>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {item.category.replace("-", " ")}
                          </Badge>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </CardContent>
          </Card>
        )}

        {/* No Results Message */}
        {showSearchResults && searchQuery && searchResults.length === 0 && (
          <Card className="absolute top-full mt-2 w-full max-w-2xl mx-auto left-1/2 transform -translate-x-1/2 z-50">
            <CardContent className="p-4 text-center">
              <p className="text-muted-foreground">No results found for &quot;{searchQuery}&quot;</p>
              <p className="text-sm text-muted-foreground mt-1">Try searching for terms like &quot;export&quot;, &quot;CSF&quot;, &quot;certificates&quot;, or &quot;organizations&quot;</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-6 mb-8">
          <TabsTrigger value="getting-started">Getting Started</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
          <TabsTrigger value="schools">Schools & CSF</TabsTrigger>
          <TabsTrigger value="certificates">Certificates</TabsTrigger>
          <TabsTrigger value="data-export">Data Export</TabsTrigger>
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

      <div className="mt-12 text-center">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-center gap-2">
              <HelpCircle className="h-5 w-5" />
              Still Need Help?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Can&apos;t find what you&apos;re looking for? We&apos;re here to help!
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline" asChild>
                <Link href="/contact">Contact Support</Link>
              </Button>
              {/* <Button variant="outline" asChild>
                <Link href="/">Send Feedback</Link>
              </Button> */}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
