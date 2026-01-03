"use client";

import { useState } from "react";
import { format, parseISO, differenceInMinutes, endOfDay, startOfDay } from "date-fns";
import { Award, Calendar, ChevronRight, Clock, BadgeCheck, Filter, MapPin, Search, SlidersHorizontal, Printer, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Certificate {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  event_start: string;
  event_end: string;
  volunteer_email: string | null;
  organization_name: string | null;
  project_id: string | null;
  schedule_id: string | null;
  issued_at: string;
  signup_id: string | null;
  volunteer_name: string | null;
  project_location: string | null;
  projects?: {
    project_timezone?: string;
  };
}

interface CertificatesListProps {
  certificates: Certificate[];
  user: {
    name: string;
    email: string;
  };
}

// Copy the formatting function
function formatTotalDuration(totalHours: number): string {
  if (totalHours <= 0) return "0m"; // Handle zero or negative hours

  // Convert decimal hours to total minutes, rounding to nearest minute
  const totalMinutes = Math.round(totalHours * 60);

  if (totalMinutes === 0) return "0m"; // Handle cases that round down to 0

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  let result = "";
  if (hours > 0) {
    result += `${hours}h`;
  }
  if (remainingMinutes > 0) {
    // Add space if hours were also added
    if (hours > 0) {
      result += " ";
    }
    result += `${remainingMinutes}m`;
  }

  // Fallback in case result is somehow empty
  return result || (totalMinutes > 0 ? "1m" : "0m");
}

// Helper to calculate duration in decimal hours
function calculateDecimalHours(startTimeISO: string, endTimeISO: string): number {
  try {
    const start = parseISO(startTimeISO);
    const end = parseISO(endTimeISO);
    const minutes = differenceInMinutes(end, start);
    return minutes > 0 ? minutes / 60 : 0;
  } catch (e) {
    console.error("Error calculating duration:", e);
    return 0; // Return 0 if parsing fails
  }
}

export function CertificatesList({ certificates, user }: CertificatesListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "hours" | "name">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  // Date filter state: all, last 6 months, last year, or custom range
  const [dateFilter, setDateFilter] = useState<"all" | "6months" | "year" | "custom">("all");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  
  // Calculate hours for a certificate
  const calculateHours = (startTime: string, endTime: string): number => {
    try {
      const start = parseISO(startTime);
      const end = parseISO(endTime);
      return Math.round(differenceInMinutes(end, start) / 60 * 10) / 10; // Round to 1 decimal place
    } catch {
      return 0;
    }
  };
  
  // Add hours property to certificates
  const certificatesWithHours = certificates.map(cert => ({
    ...cert,
    hours: calculateHours(cert.event_start, cert.event_end)
  }));
  
  // Apply search filter
  const filteredCertificates = certificatesWithHours.filter(cert => {
    // Search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      if (
        !cert.project_title.toLowerCase().includes(searchLower) &&
        !(cert.organization_name?.toLowerCase().includes(searchLower)) &&
        !(cert.project_location?.toLowerCase().includes(searchLower))
      ) {
        return false;
      }
    }
    // Date range filter
    const issuedDate = new Date(cert.issued_at);
    const now = new Date();
    switch (dateFilter) {
      case "6months": {
        const cutoff = new Date(now);
        cutoff.setMonth(cutoff.getMonth() - 6);
        if (issuedDate < cutoff) return false;
        break;
      }
      case "year": {
        const cutoff = new Date(now);
        cutoff.setFullYear(cutoff.getFullYear() - 1);
        if (issuedDate < cutoff) return false;
        break;
      }
      case "custom": {
        if (startDate) {
          // Use startOfDay to ensure we include the entire start date
          if (issuedDate < startOfDay(startDate)) return false;
        }
        if (endDate) {
          // Use endOfDay to ensure we include the entire end date
          if (issuedDate > endOfDay(endDate)) return false;
        }
        break;
      }
      // "all" or default: no filtering
    }
    return true;
  });
  
  // Apply sorting
  const sortedCertificates = [...filteredCertificates].sort((a, b) => {
    let comparison = 0;
    
    if (sortBy === "date") {
      comparison = new Date(a.issued_at).getTime() - new Date(b.issued_at).getTime();
    } else if (sortBy === "hours") {
      comparison = a.hours - b.hours;
    } else if (sortBy === "name") {
      comparison = a.project_title.localeCompare(b.project_title);
    }
    
    return sortDirection === "asc" ? comparison : -comparison;
  });
  
  // Toggle sort direction when clicking the same sort option
  const handleSortChange = (newSortBy: "date" | "hours" | "name") => {
    if (newSortBy === sortBy) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(newSortBy);
      setSortDirection("desc"); // Default to descending for new sort option
    }
  };
  
  // Print all certificates in a clean, styled container
  const printCertificates = () => {
    // Calculate total hours on filtered results
    const totalHours = filteredCertificates.reduce((sum, cert) => sum + cert.hours, 0);
    const totalDuration = formatTotalDuration(totalHours);
    // prepare container
    let container = document.getElementById("print-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "print-container";
      container.className = "hidden print:block";
      document.body.appendChild(container);
    }

    const style = `
      <style>
      @media print {
        body > *:not(#print-container) { display: none !important; }
        #print-container { display: block !important; font-family: Arial, sans-serif; margin: 10px; color: #000; }
        h1 { font-size: 20px; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #ddd; padding: 6px; font-size: 14px; text-align: left; }
        th { background: #f2f2f2; }
      }
      </style>`;

    const content = `
      ${style}
      <h1>All Certificates for ${user.name}</h1>
      <div>Email: ${user.email}</div>
      <div>Printed: ${new Date().toLocaleString()} ${(() => {
        try {
          return new Intl.DateTimeFormat('en-US', { 
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, 
            timeZoneName: 'short' 
          }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value || '';
        } catch {
          return '';
        }
      })()}</div>
      <div><strong>Total Hours: ${totalDuration}</strong></div>
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Issued by</th>
            <th>Date</th>
            <th>Duration</th>
            <th>Certified</th>
          </tr>
        </thead>
        <tbody>
          ${certificatesWithHours
            .filter(cert => {
              // apply same date filtering
              const issued = new Date(cert.issued_at);
              const now = new Date();
              switch (dateFilter) {
                case "6months": {
                  const cut = new Date(now);
                  cut.setMonth(cut.getMonth() - 6);
                  if (issued < cut) return false;
                  break;
                }
                case "year": {
                  const cut = new Date(now);
                  cut.setFullYear(cut.getFullYear() - 1);
                  if (issued < cut) return false;
                  break;
                }
                case "custom": {
                  if (startDate && issued < startOfDay(startDate)) return false;
                  if (endDate && issued > endOfDay(endDate)) return false;
                  break;
                }
              }
              return true;
            })
            .map(cert => `
              <tr>
                <td>${cert.project_title}</td>
                <td>${cert.organization_name || cert.creator_name || "-"}</td>
                <td>${format(parseISO(cert.issued_at), "MMM d, yyyy")} ${(() => {
                  const date = parseISO(cert.issued_at);
                  const timezone = cert.projects?.project_timezone || 'America/Los_Angeles';
                  try {
                    return new Intl.DateTimeFormat('en-US', { 
                      timeZone: timezone, 
                      timeZoneName: 'short' 
                    }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || '';
                  } catch {
                    return '';
                  }
                })()}</td>
                <td>${formatTotalDuration(calculateDecimalHours(cert.event_start, cert.event_end))}</td>
                <td>${cert.is_certified ? "Yes" : "No"}</td>
              </tr>
            `)
            .join("")}
        </tbody>
      </table>
      <p style="margin-top:12px;font-size:12px;color:#555;">
        Certified means this certificate comes from a verified organization checked by the Let’s Assist team.
      </p>`;

    container.innerHTML = content;
    setTimeout(() => window.print(), 100);
  };
  
  if (certificates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Award className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="font-medium text-lg">No Certificates Yet</h3>
        <p className="text-muted-foreground max-w-md mt-1">
          Your certificates will appear here once you&apos;ve completed volunteer events and organizers have finalized your hours.
        </p>
        <Button className="mt-6" asChild>
          <Link href="/home">Find Opportunities</Link>
        </Button>
      </div>
    );
  }
  
  return (
<>

      {/* Search and Filter */}
      <div className="w-full space-y-4 sm:space-y-8 mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Certificates</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              View and manage your earned volunteer certificates below.
            </p>
          </div>
        </div>
        <div className="flex flex-row flex-wrap gap-2 items-center justify-between">
          <div className="relative w-auto sm:flex-1 min-w-[100px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Search..."
                aria-label="Search certificates"
                className="pl-8 w-full h-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
          </div>
          <div className="flex flex-row flex-wrap gap-1 sm:gap-3 flex-shrink-0">
            {/* Date range filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 h-9"
                  aria-label="Filter by date range"
                >
                  <Filter className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline ml-1">
                    Date: {dateFilter === 'all' ? 'All' : dateFilter === '6months' ? '6mo' : dateFilter === 'year' ? '1yr' : 'Custom'}
                  </span>
                </Button>
              </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Date Range</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setDateFilter('all')}>All</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateFilter('6months')}>Last 6 Months</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateFilter('year')}>Last Year</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateFilter('custom')}>Custom Range</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {dateFilter === 'custom' && (
            <div className="flex flex-row flex-wrap items-center gap-1 sm:gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-auto p-4 justify-start text-left font-normal h-9",
                      !startDate && "text-muted-foreground"
                    )}
                    aria-label="Select start date"
                  >
                    <Calendar className="mr-1 h-3 w-3" />
                    {startDate ? format(startDate, "MM/dd/yy") : "Start"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <span className="hidden sm:inline text-sm">to</span>
              <span className="inline sm:hidden text-xs">-</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-auto p-4 justify-start text-left font-normal h-9",
                      !endDate && "text-muted-foreground"
                    )}
                    aria-label="Select end date"
                  >
                    <Calendar className="mr-1 h-3 w-3" />
                    {endDate ? format(endDate, "MM/dd/yy") : "End"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              {(startDate || endDate) && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => {
                    setStartDate(undefined);
                    setEndDate(undefined);
                  }}
                  className="h-7 w-7"
                  aria-label="Clear date selection"
                >
                  <span className="sr-only">Clear dates</span>
                  <X className="h-3 w-3 text-muted-foreground" />
                </Button>
              )}
            </div>
          )}
          {/* Sort certificates */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1 h-9"
                aria-label="Sort certificates"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline ml-1">Sort</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort Certificates</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => handleSortChange("date")}>
                  <Calendar className="h-4 w-4 mr-2" aria-hidden="true" />
                  <span>Date {sortBy === "date" && (sortDirection === "desc" ? "↓" : "↑")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSortChange("hours")}>
                  <Clock className="h-4 w-4 mr-2" aria-hidden="true" />
                  <span>Hours {sortBy === "hours" && (sortDirection === "desc" ? "↓" : "↑")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSortChange("name")}>
                  <Award className="h-4 w-4 mr-2" aria-hidden="true" />
                  <span>Project Name {sortBy === "name" && (sortDirection === "desc" ? "↓" : "↑")}</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={printCertificates}
            className="h-9"
            aria-label="Print all certificates"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline ml-1">Print</span>
          </Button>
        </div>
      </div>
      
      {/* Certificates Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {sortedCertificates.map((cert) => {



          return (
            <Link key={cert.id} href={`/certificates/${cert.id}`} passHref>
              <Card className="group h-full cursor-pointer transition-all duration-300 hover:shadow-lg hover:border-primary/50 flex flex-col">
                <CardHeader className="pb-3 relative">
                  <div className="absolute right-4 top-4">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <BadgeCheck className={`h-5 w-5 ${cert.is_certified ? 'text-primary' : 'text-muted-foreground/30'}`} />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {cert.is_certified 
                              ? "Certificate comes from a verified organization"
                              : "Certificate does not come from a verified organization"
                            }
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <CardTitle className="text-xl font-semibold leading-tight line-clamp-2 pr-8">
                    {cert.project_title}
                  </CardTitle>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                    {cert.organization_name && (
                      <div className="flex items-center gap-2 max-w-full">
                        <span className="truncate">{cert.organization_name}</span>
                        <span className="text-muted-foreground/50">•</span>
                      </div>
                    )}
                    <span className="flex-shrink-0">{format(parseISO(cert.issued_at), "MMM d, yyyy")}</span>
                  </div>
                </CardHeader>
                
                <CardContent className="pb-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant="outline"
                      className="bg-chart-4/5 border-chart-4/20 text-chart-4 hover:bg-chart-4/10 transition-colors"
                    >
                      <Clock className="h-3 w-3 mr-1" />
                      {cert.hours} hours
                    </Badge>
                    {cert.is_certified && (
                      <Badge 
                        variant="outline" 
                        className="bg-chart-5/5 border-chart-5/20 text-chart-5 hover:bg-chart-5/10 transition-colors"
                      >
                        <BadgeCheck className="h-3 w-3 mr-1" />
                        Certified
                      </Badge>
                    )}
                    {cert.project_location && (
                      <Badge 
                        variant="outline" 
                        className="bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <MapPin className="h-3 w-3 mr-1" />
                        {cert.project_location}
                      </Badge>
                    )}
                  </div>
                </CardContent>
                
                <CardFooter className="mt-auto pt-3 pb-4 px-4 border-t">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full justify-between"
                  >
                    <span>View Certificate</span>
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </CardFooter>
              </Card>
            </Link>
          );
        })}
      </div>
      
      {/* Show message if no results found */}
      {filteredCertificates.length === 0 && (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No certificates match your search.</p>
        </div>
      )}
    </div>
    </>
  );
}
