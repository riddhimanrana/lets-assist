"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { 
  Clock, 
  Users, 
  FileSpreadsheet, 
  GraduationCap, 
  CheckCircle, 
  Plus, 
  Upload,
  Settings,
  HelpCircle,
  BookOpen,
  Target,
  Award,
  Search,
  X
} from "lucide-react";
import Link from "next/link";

// Search index for all help content
const searchIndex = [
  {
    id: "getting-started-welcome",
    title: "Welcome to Let's Assist",
    category: "getting-started",
    content: "complete guide tracking volunteer hours managing projects quick start create account profile browse create project track volunteer hours",
    section: "Welcome"
  },
  {
    id: "getting-started-account",
    title: "Setting Up Your Account",
    category: "getting-started", 
    content: "account setup profile full name contact information upload picture time zone notification preferences connect organizations",
    section: "Account Setup"
  },
  {
    id: "getting-started-navigation",
    title: "Navigating the Platform",
    category: "getting-started",
    content: "navigation platform home dashboard projects organizations quick actions create new projects settings profile menu export data",
    section: "Navigation"
  },
  {
    id: "projects-creating",
    title: "Creating Projects",
    category: "projects",
    content: "create new project project name description start end dates category team members hour tracking preferences individual team organization event",
    section: "Project Creation"
  },
  {
    id: "projects-tracking",
    title: "Hour Tracking",
    category: "projects",
    content: "tracking hours live timer start stop manual entry bulk import upload spreadsheet verification project supervisors organization coordinators automatic verification",
    section: "Hour Tracking"
  },
  {
    id: "projects-csv",
    title: "CSV Export & Import",
    category: "projects",
    content: "csv export import data reports school requirements dashboard export data date range format pdf download existing records upload map columns",
    section: "Data Management"
  },
  {
    id: "organizations-volunteers",
    title: "Joining Organizations",
    category: "organizations",
    content: "joining organizations browse available request join invitation code approval organization admin participating organization projects",
    section: "For Volunteers"
  },
  {
    id: "organizations-projects",
    title: "Organization Projects",
    category: "organizations",
    content: "organization projects volunteer opportunities team projects automatic hour verification organization admins resources guidelines",
    section: "Organization Features"
  },
  {
    id: "organizations-admins",
    title: "Creating Organizations",
    category: "organizations",
    content: "creating organizations apply organization account details verification projects volunteer opportunities invite volunteers manage volunteers review approve applications verify hours",
    section: "For Admins"
  },
  {
    id: "schools-csf",
    title: "CSF Programs",
    category: "schools",
    content: "california scholarship federation csf volunteer hours school programs csf requirements membership verification reporting students track hours csf compliant documentation supervisor verification export reports",
    section: "CSF & Schools"
  },
  {
    id: "schools-students",
    title: "School-Approved Projects",
    category: "schools", 
    content: "school approved projects csf eligible volunteer work tutoring students school events community clean up library nonprofit senior center activities",
    section: "Student Projects"
  },
  {
    id: "schools-setup",
    title: "School Program Setup",
    category: "schools",
    content: "school program setup school organization account csf volunteer program requirements invite students monitor progress verify hours dashboard student progress automated alerts bulk export school records",
    section: "School Administration"
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
          Everything you need to know about using Let&apos;s Assist for volunteer hour tracking and project management.
        </p>
      </div>

      {/* Search Section */}
      <div className="mb-8 relative">
        <div className="relative max-w-2xl mx-auto">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search help articles... (e.g., 'CSF hours', 'export data', 'create project')"
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
              <p className="text-sm text-muted-foreground mt-1">Try searching for terms like &quot;CSF&quot;, &quot;export&quot;, &quot;projects&quot;, or &quot;organizations&quot;</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 mb-8">
          <TabsTrigger value="getting-started">Getting Started</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
          <TabsTrigger value="schools">Schools & CSF</TabsTrigger>
        </TabsList>

        <TabsContent value="getting-started" className="space-y-6">
          <Card id="getting-started-welcome">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Welcome to Let&apos;s Assist
              </CardTitle>
              <CardDescription>
                Your complete guide to tracking volunteer hours and managing projects
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <h4 className="font-semibold">Quick Start</h4>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-chart-5" />
                      Create your account and complete profile
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-chart-5" />
                      Browse or create your first project
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-chart-5" />
                      Start tracking your volunteer hours
                    </li>
                  </ul>
                </div>
                <div className="space-y-3">
                  <h4 className="font-semibold">Key Features</h4>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">Hour Tracking</Badge>
                    <Badge variant="secondary">Project Management</Badge>
                    <Badge variant="secondary">CSV Export</Badge>
                    <Badge variant="secondary">Team Collaboration</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="account-setup" id="getting-started-account">
              <AccordionTrigger>Setting Up Your Account</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p>Follow these steps to get your account ready:</p>
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  <li>Complete your profile with your full name and contact information</li>
                  <li>Upload a profile picture (optional but recommended)</li>
                  <li>Set your time zone and notification preferences</li>
                  <li>Connect with organizations you volunteer with</li>
                </ol>
                <Button asChild size="sm">
                  <Link href="/dashboard">Go to Dashboard</Link>
                </Button>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="navigation" id="getting-started-navigation">
              <AccordionTrigger>Navigating the Platform</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <h5 className="font-medium mb-2">Main Sections:</h5>
                    <ul className="space-y-1">
                      <li><strong>Home:</strong> Your activity overview</li>
                      <li><strong>Dashboard:</strong> Hour tracking and stats</li>
                      <li><strong>Projects:</strong> Manage your volunteer projects</li>
                      <li><strong>Organizations:</strong> Connect with groups</li>
                    </ul>
                  </div>
                  <div>
                    <h5 className="font-medium mb-2">Quick Actions:</h5>
                    <ul className="space-y-1">
                      <li>Use the + button to create new projects</li>
                      <li>Access settings from your profile menu</li>
                      <li>Export data from the dashboard</li>
                    </ul>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </TabsContent>

        <TabsContent value="projects" className="space-y-6">
          <div className="grid lg:grid-cols-2 gap-6">
            <Card id="projects-creating">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  Creating Projects
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Accordion type="single" collapsible>
                  <AccordionItem value="new-project">
                    <AccordionTrigger>How to Create a New Project</AccordionTrigger>
                    <AccordionContent className="space-y-2 text-sm">
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Click the &quot;Create Project&quot; button</li>
                        <li>Fill in project name and description</li>
                        <li>Set start and end dates</li>
                        <li>Choose project category</li>
                        <li>Add team members (optional)</li>
                        <li>Set hour tracking preferences</li>
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                  
                  <AccordionItem value="project-types">
                    <AccordionTrigger>Project Types</AccordionTrigger>
                    <AccordionContent className="space-y-2 text-sm">
                      <ul className="space-y-1">
                        <li><strong>Individual:</strong> Personal volunteer work</li>
                        <li><strong>Team:</strong> Collaborative projects with multiple volunteers</li>
                        <li><strong>Organization:</strong> Projects managed by partner organizations</li>
                        <li><strong>Event:</strong> One-time volunteer events</li>
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>

            <Card id="projects-tracking">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Hour Tracking
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Accordion type="single" collapsible>
                  <AccordionItem value="track-hours">
                    <AccordionTrigger>Tracking Your Hours</AccordionTrigger>
                    <AccordionContent className="space-y-2 text-sm">
                      <p>Three ways to track your volunteer time:</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li><strong>Live Timer:</strong> Start/stop timer while volunteering</li>
                        <li><strong>Manual Entry:</strong> Add hours after completing work</li>
                        <li><strong>Bulk Import:</strong> Upload hours from spreadsheet</li>
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                  
                  <AccordionItem value="verification">
                    <AccordionTrigger>Hour Verification</AccordionTrigger>
                    <AccordionContent className="space-y-2 text-sm">
                      <p>Hours can be verified by:</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>Project supervisors</li>
                        <li>Organization coordinators</li>
                        <li>Automatic verification for certain project types</li>
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>
          </div>

          <Card id="projects-csv">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                CSV Export & Import
              </CardTitle>
              <CardDescription>
                Export your data or import existing volunteer records
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible>
                <AccordionItem value="csv-export">
                  <AccordionTrigger>Exporting Your Data</AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <p>Export your volunteer hours for reports or school requirements:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Go to your Dashboard</li>
                      <li>Click &quot;Export Data&quot; button</li>
                      <li>Select date range and projects</li>
                      <li>Choose format (CSV, PDF, or both)</li>
                      <li>Download your report</li>
                    </ol>
                    <div className="bg-chart-3/20  p-3 rounded-lg">
                      <p className="text-xs"><strong>Tip:</strong> CSV files can be opened in Excel or Google Sheets for further analysis.</p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                
                <AccordionItem value="csv-import">
                  <AccordionTrigger>Importing Existing Records</AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <p>Upload your existing volunteer hour records:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Prepare your CSV with columns: Date, Hours, Description, Organization</li>
                      <li>Go to Projects → Import Hours</li>
                      <li>Upload your CSV file</li>
                      <li>Review and map columns</li>
                      <li>Confirm import</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="organizations" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Working with Organizations
              </CardTitle>
              <CardDescription>
                Connect with volunteer organizations and manage team projects
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-semibold">For Volunteers</h4>
                  <Accordion type="single" collapsible>
                    <AccordionItem value="join-org">
                      <AccordionTrigger>Joining Organizations</AccordionTrigger>
                      <AccordionContent className="space-y-2 text-sm">
                        <ol className="list-decimal list-inside space-y-1">
                          <li>Browse available organizations</li>
                          <li>Request to join or use invitation code</li>
                          <li>Wait for approval from organization admin</li>
                          <li>Start participating in organization projects</li>
                        </ol>
                      </AccordionContent>
                    </AccordionItem>
                    
                    <AccordionItem value="org-projects">
                      <AccordionTrigger>Organization Projects</AccordionTrigger>
                      <AccordionContent className="space-y-2 text-sm">
                        <ul className="list-disc list-inside space-y-1 ml-2">
                          <li>View organization-specific volunteer opportunities</li>
                          <li>Join team projects with other volunteers</li>
                          <li>Automatic hour verification by organization admins</li>
                          <li>Access organization resources and guidelines</li>
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
                
                <div className="space-y-4">
                  <h4 className="font-semibold">For Organization Admins</h4>
                  <Accordion type="single" collapsible>
                    <AccordionItem value="create-org">
                      <AccordionTrigger>Creating Organizations</AccordionTrigger>
                      <AccordionContent className="space-y-2 text-sm">
                        <ol className="list-decimal list-inside space-y-1">
                          <li>Apply to create an organization account</li>
                          <li>Provide organization details and verification</li>
                          <li>Set up projects and volunteer opportunities</li>
                          <li>Invite volunteers to join</li>
                        </ol>
                      </AccordionContent>
                    </AccordionItem>
                    
                    <AccordionItem value="manage-volunteers">
                      <AccordionTrigger>Managing Volunteers</AccordionTrigger>
                      <AccordionContent className="space-y-2 text-sm">
                        <ul className="list-disc list-inside space-y-1 ml-2">
                          <li>Review and approve volunteer applications</li>
                          <li>Verify submitted volunteer hours</li>
                          <li>Create and assign team projects</li>
                          <li>Generate reports for your volunteers</li>
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schools" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5" />
                Schools & CSF Programs
              </CardTitle>
              <CardDescription>
                Perfect for California Scholarship Federation and other school volunteer programs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-full">
                      <Award className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">CSF Hour Requirements Made Easy</CardTitle>
                      <CardDescription>
                        Track and verify the volunteer hours required for CSF membership with built-in verification and reporting.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold mb-3">For Students</h4>
                  <Accordion type="single" collapsible>
                    <AccordionItem value="csf-tracking">
                      <AccordionTrigger>CSF Hour Tracking</AccordionTrigger>
                      <AccordionContent className="space-y-2 text-sm">
                        <ul className="list-disc list-inside space-y-1 ml-2">
                          <li>Create projects specifically tagged for CSF requirements</li>
                          <li>Track hours with automatic CSF-compliant documentation</li>
                          <li>Get supervisor verification built into the platform</li>
                          <li>Export CSF-ready reports for school submission</li>
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                    
                    <AccordionItem value="school-projects">
                      <AccordionTrigger>School-Approved Projects</AccordionTrigger>
                      <AccordionContent className="space-y-2 text-sm">
                        <p>Examples of CSF-eligible volunteer work:</p>
                        <ul className="list-disc list-inside space-y-1 ml-2">
                          <li>Tutoring younger students</li>
                          <li>School event assistance</li>
                          <li>Community clean-up projects</li>
                          <li>Library or nonprofit organization help</li>
                          <li>Senior center activities</li>
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
                
                <div>
                  <h4 className="font-semibold mb-3">For Schools & Advisors</h4>
                  <Accordion type="single" collapsible>
                    <AccordionItem value="school-setup">
                      <AccordionTrigger>Setting Up School Programs</AccordionTrigger>
                      <AccordionContent className="space-y-2 text-sm">
                        <ol className="list-decimal list-inside space-y-1">
                          <li>Create a school organization account</li>
                          <li>Set up CSF or other volunteer program requirements</li>
                          <li>Invite students to join your school&apos;s program</li>
                          <li>Monitor student progress and verify hours</li>
                        </ol>
                      </AccordionContent>
                    </AccordionItem>
                    
                    <AccordionItem value="student-monitoring">
                      <AccordionTrigger>Monitoring Student Progress</AccordionTrigger>
                      <AccordionContent className="space-y-2 text-sm">
                        <ul className="list-disc list-inside space-y-1 ml-2">
                          <li>Dashboard view of all student volunteer hours</li>
                          <li>Automated alerts for students nearing deadlines</li>
                          <li>Bulk export of student data for school records</li>
                          <li>Integration with school information systems</li>
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </div>

              <Card className="border-chart-4/30 bg-chart-4/5">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="bg-chart-4/10 p-2 rounded-full">
                      <Target className="h-5 w-5 text-chart-4" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Quick CSF Setup Guide</CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Create account and select &quot;Student&quot; role</li>
                    <li>Join your school&apos;s CSF organization (if available)</li>
                    <li>Create a project tagged as &quot;CSF Volunteer Hours&quot;</li>
                    <li>Track hours with detailed descriptions of activities</li>
                    <li>Get supervisor verification for each volunteer session</li>
                    <li>Export final report when ready to submit to school</li>
                  </ol>
                </CardContent>
              </Card>
            </CardContent>
          </Card>
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
              <Button variant="outline" asChild>
                <Link href="/feedback">Send Feedback</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
