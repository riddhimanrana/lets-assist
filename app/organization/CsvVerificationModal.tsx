"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileCheck, Upload, AlertCircle, CheckCircle, XCircle, FileText, ChevronRight, Clock, CircleCheck, CopyCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface VerificationResult {
  valid: boolean;
  exists: boolean;
  certificate?: {
    id: string;
    certified: boolean;
    issuedAt: string;
    recipient: {
      name: string;
      email: string;
    }
  };
  event?: {
    startDate: string;
    endDate: string;
  };
  project?: {
    id: string;
    title: string;
    location: string;
  };
  organization?: {
    name: string;
  };
  organizer?: {
    id: string;
    name: string;
  };
  verification?: {
    timestamp: string;
    matches?: {
      certificateId: boolean;
      title: boolean;
      organizer: boolean;
      hours: boolean;
      status: boolean;
    };
  };
  error?: string;
}

interface CertificateRow {
  certificateId: string;
  projectTitle: string;
  organizationName: string;
  organizerName: string;
  certificationStatus: string;
  eventStartDate?: string;
  eventEndDate?: string;
  duration?: string;
  location?: string;
  issuedDate?: string;
  valid: boolean;
  issues: string[];
  verificationStatus?: 'pending' | 'verified' | 'failed';
  verificationResult?: VerificationResult;
  isVerified?: boolean;
}

interface CsvVerificationModalProps {
  children?: React.ReactNode;
}

export function CsvVerificationModal({ children }: CsvVerificationModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<CertificateRow[]>([]);
  const [summary, setSummary] = useState<{
    total: number;
    verified: number;
    mismatchedData: number;
    invalidFormat: number;
    totalHours: number;
    certifiedCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [currentVerifyIndex, setCurrentVerifyIndex] = useState<number>(-1);
  const [verificationProgress, setVerificationProgress] = useState<number>(0);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    
    // Reset any previous errors
    setError(null);
    setResults([]);
    setSummary(null);
    
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
    } else if (selectedFile) {
      setError('Please select a valid CSV file');
      setFile(null);
      // Clear the input
      event.target.value = '';
    } else {
      setFile(null);
    }
  };

  const parseCsvLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  };

  const validateCertificateRow = (row: string[], headers: string[]): CertificateRow => {
    const issues: string[] = [];
    const certificateId = row[0]?.trim() || '';
    const projectTitle = row[1]?.trim() || '';
    const organizationName = row[2]?.trim() || '';
    const organizerName = row[3]?.trim() || '';
    const certificationStatus = row[4]?.trim() || '';
    const eventStartDate = row[5]?.trim() || '';
    const eventEndDate = row[6]?.trim() || '';
    const duration = row[7]?.trim() || '';
    const location = row[8]?.trim() || '';
    const issuedDate = row[9]?.trim() || '';

    // Validation rules
    if (!certificateId) issues.push('Missing certificate ID');
    if (!projectTitle) issues.push('Missing project title');
    if (!organizerName) issues.push('Missing organizer name');
    if (!certificationStatus) issues.push('Missing certification status');
    
    // Check for valid ID format (UUID or similar)
    if (certificateId && !/^[A-Za-z0-9\-_]+$/.test(certificateId)) {
      issues.push('Invalid certificate ID format');
    }

    // Check for minimum title length
    if (projectTitle && projectTitle.length < 3) {
      issues.push('Project title too short');
    }

    // Check for valid organizer name
    if (organizerName && organizerName.length < 2) {
      issues.push('Invalid organizer name');
    }

    // Check certification status
    if (certificationStatus && !['Certified', 'Participated'].includes(certificationStatus)) {
      issues.push('Invalid certification status (must be "Certified" or "Participated")');
    }

    // Date validation if provided
    if (eventStartDate) {
      const date = new Date(eventStartDate);
      if (isNaN(date.getTime())) {
        issues.push('Invalid event start date format');
      }
    }

    if (eventEndDate) {
      const date = new Date(eventEndDate);
      if (isNaN(date.getTime())) {
        issues.push('Invalid event end date format');
      }
    }

    if (issuedDate) {
      const date = new Date(issuedDate);
      if (isNaN(date.getTime())) {
        issues.push('Invalid issued date format');
      }
    }

    // Duration validation
    if (duration && isNaN(parseFloat(duration))) {
      issues.push('Invalid duration format');
    }

    return {
      certificateId,
      projectTitle,
      organizationName,
      organizerName,
      certificationStatus,
      eventStartDate,
      eventEndDate,
      duration,
      location,
      issuedDate,
      valid: issues.length === 0,
      issues
    };
  };

  const processAndVerifyCsv = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setVerifying(true);
    setVerificationProgress(0);

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        setError('CSV file must contain at least a header row and one data row');
        return;
      }

      const headers = parseCsvLine(lines[0]);
      const expectedHeaders = ['certificate id', 'project title', 'organization name', 'project organizer name', 'certification status'];
      
      // Check if required headers are present (case insensitive)
      const hasRequiredHeaders = expectedHeaders.every(expected => 
        headers.some(header => header.toLowerCase().includes(expected))
      );

      if (!hasRequiredHeaders) {
        setError('CSV must contain the expected certificate columns: Certificate ID, Project Title, Organization Name, Project Organizer Name, Certification Status');
        return;
      }

      const processedResults: CertificateRow[] = [];
      const seenCertificateIds = new Set<string>();
      const duplicateIds = new Set<string>();
      
      // Process rows until we hit the summary section
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Stop processing when we hit the summary section
        if (line.includes('=== SUMMARY ===') || line.includes('===SUMMARY===')) {
          break;
        }
        
        const row = parseCsvLine(line);
        if (row.some(cell => cell.trim())) { // Skip empty rows
          const result = validateCertificateRow(row, headers);
          
          // Check for duplicates based on certificate ID
          if (result.certificateId) {
            const certificateId = result.certificateId.toLowerCase().trim();
            if (seenCertificateIds.has(certificateId)) {
              duplicateIds.add(certificateId);
              // Mark this row as invalid due to duplicate
              result.valid = false;
              result.issues.push('Duplicate certificate ID found in CSV');
            } else {
              seenCertificateIds.add(certificateId);
            }
          }
          
          processedResults.push(result);
        }
      }

      // Check if duplicates were found and handle them
      if (duplicateIds.size > 0) {
        // Mark all rows with duplicate IDs as invalid
        processedResults.forEach(row => {
          if (row.certificateId && duplicateIds.has(row.certificateId.toLowerCase().trim())) {
            row.valid = false;
            if (!row.issues.includes('Duplicate certificate ID found in CSV')) {
              row.issues.push('Duplicate certificate ID found in CSV');
            }
          }
        });

        const duplicateCount = processedResults.filter(row => 
          row.certificateId && duplicateIds.has(row.certificateId.toLowerCase().trim())
        ).length;

        setError(
          `Found ${duplicateIds.size} duplicate certificate ID${duplicateIds.size > 1 ? 's' : ''} affecting ${duplicateCount} row${duplicateCount > 1 ? 's' : ''}. ` +
          `Please remove duplicate entries before proceeding with verification. ` +
          `Duplicate ID${duplicateIds.size > 1 ? 's' : ''}: ${Array.from(duplicateIds).join(', ')}`
        );
        
        // Still show the results but don't proceed with verification
        setResults(processedResults);
        setSummary({
          total: processedResults.length,
          verified: 0,
          mismatchedData: 0,
          invalidFormat: processedResults.filter(r => !r.valid).length,
          totalHours: 0,
          certifiedCount: 0
        });
        return;
      }

      setResults(processedResults);
      
      // Now verify certificates
      const validRows = processedResults.filter(row => row.valid && row.certificateId);
      let verifiedCount = 0;
      let mismatchedCount = 0;
      let certifiedCount = 0;
      let totalHours = 0;
      
      if (validRows.length > 0) {
        const updatedResults = [...processedResults];
        
        for (let i = 0; i < validRows.length; i++) {
          setCurrentVerifyIndex(i);
          const row = validRows[i];
          const index = processedResults.findIndex(r => r.certificateId === row.certificateId);
          
          if (index !== -1) {
            // Update the row status to indicate verification is in progress
            updatedResults[index] = {
              ...updatedResults[index],
              verificationStatus: 'pending'
            };
            setResults([...updatedResults]);
            
            // Verify the certificate
            const verifiedRow = await verifyCertificateId(row.certificateId, row);
            
            if (verifiedRow) {
              updatedResults[index] = verifiedRow;
              setResults([...updatedResults]);
              
              // Update verification stats
              if (verifiedRow.isVerified) {
                verifiedCount++;
                // Only count hours for verified certificates
                if (verifiedRow.duration) {
                  const hours = parseFloat(verifiedRow.duration);
                  if (!isNaN(hours)) {
                    totalHours += hours;
                  }
                }
              } else if (verifiedRow.verificationStatus === 'verified' && !verifiedRow.isVerified) {
                mismatchedCount++;
              }
              
              // Count certified certificates
              if (verifiedRow.verificationResult?.valid && verifiedRow.verificationResult?.certificate?.certified) {
                certifiedCount++;
              }
            }
          }
          
          // Update progress
          setVerificationProgress(Math.round(((i + 1) / validRows.length) * 100));
        }
        
        setResults(updatedResults);
      }

      setSummary({
        total: processedResults.length,
        verified: verifiedCount,
        mismatchedData: mismatchedCount,
        invalidFormat: processedResults.filter(r => !r.valid).length + (validRows.length - verifiedCount - mismatchedCount), // Include format issues + not found
        totalHours: totalHours,
        certifiedCount
      });

      if (processedResults.filter(r => !r.valid).length > 0) {
        toast({
          title: "Format Issues Found",
          description: `${processedResults.filter(r => !r.valid).length} records have format issues. Check the details below.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Verification Complete",
          description: `Processed ${processedResults.length} records, verified ${verifiedCount} certificates`,
          variant: "default",
        });
      }

    } catch (err) {
      setError('Failed to process CSV file. Please check the file format.');
    } finally {
      setIsProcessing(false);
      setVerifying(false);
      setCurrentVerifyIndex(-1);
      setVerificationProgress(0);
    }
  };

  const resetModal = () => {
    setFile(null);
    setResults([]);
    setSummary(null);
    setError(null);
    setIsProcessing(false);
    setVerifying(false);
    setCurrentVerifyIndex(-1);
    setVerificationProgress(0);
    
    // Also reset the file input
    const fileInput = document.getElementById('csv-file') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const handleClose = () => {
    resetModal();
    setIsOpen(false);
  };

  const verifyCertificateId = async (certificateId: string, row: CertificateRow): Promise<CertificateRow | null> => {
    if (!certificateId) return null;

    try {
      // First do a basic verification to check if certificate exists
      const response = await fetch(`/api/certificates/verify/${encodeURIComponent(certificateId)}`);
      const result: VerificationResult = await response.json();
      
      if (response.ok && result.valid && result.exists) {
        // Calculate hours from event duration
        let calculatedHours = 0;
        if (result.event?.startDate && result.event?.endDate) {
          const start = new Date(result.event.startDate);
          const end = new Date(result.event.endDate);
          calculatedHours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60) * 10) / 10; // Round to 1 decimal
        }

        // Compare with CSV data
        const csvHours = row.duration ? parseFloat(row.duration) : 0;
        const hoursMatch = Math.abs(calculatedHours - csvHours) <= 0.1; // Allow 0.1h difference
        
        const titleMatch = result.project?.title?.toLowerCase() === row.projectTitle?.toLowerCase();
        const organizerMatch = result.organizer?.name?.toLowerCase() === row.organizerName?.toLowerCase();
        const statusMatch = result.certificate?.certified === (row.certificationStatus === 'Certified');

        // Update the row with verification result
        const updatedRow: CertificateRow = {
          ...row,
          verificationStatus: 'verified',
          verificationResult: {
            ...result,
            verification: {
              timestamp: new Date().toISOString(),
              matches: {
                certificateId: true,
                title: titleMatch,
                organizer: organizerMatch,
                hours: hoursMatch,
                status: statusMatch
              }
            }
          },
          isVerified: titleMatch && organizerMatch && hoursMatch && statusMatch
        };
        
        return updatedRow;
      } else {
        return {
          ...row,
          verificationStatus: 'failed',
          verificationResult: {
            valid: false,
            exists: false,
            error: result.error || 'Certificate not found'
          },
          isVerified: false
        };
      }
    } catch (error) {
      console.error('Error verifying certificate:', error);
      return {
        ...row,
        verificationStatus: 'failed',
        verificationResult: {
          valid: false,
          exists: false,
          error: 'Network error during verification'
        },
        isVerified: false
      };
    }
  };

  // Remove the old separate verification function since it's now combined

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) {
        resetModal(); // Reset immediately when closing
      }
    }}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              {children || (
                <Button variant="outline" size="sm" className="text-xs sm:text-sm">
                  <FileCheck className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">Verify Certificates</span>
                  <span className="sm:hidden">Verify</span>
                </Button>
              )}
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Upload a CSV file to verify certificate data format and validity</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DialogContent className=" max-h-[90vh] max-w-5xl p-0 flex flex-col gap-0">
        <DialogHeader className="px-4 sm:px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <FileCheck className="w-4 h-4 sm:w-5 sm:h-5" />
            Certificate CSV Verification
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            Upload a CSV file, verify its format, and check certificates against our database.
          </DialogDescription>
        </DialogHeader>

        {/* Controls Section - Fixed */}
        <div className="p-3 sm:p-4 lg:p-6 border-b shrink-0 bg-muted/30">
          <div className="space-y-3 sm:space-y-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="csv-file" className="text-sm font-medium">1. Select Certificate CSV File</Label>
                <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-3 sm:p-4 flex flex-col items-center justify-center hover:bg-muted/50 transition-colors cursor-pointer bg-muted/20">
                  <Input
                    id="csv-file"
                    key={file ? file.name : 'no-file'} // Force re-render when file changes
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={isProcessing || verifying}
                  />
                  <label htmlFor="csv-file" className="w-full h-full flex flex-col items-center justify-center cursor-pointer">
                    <FileText className="w-6 h-6 sm:w-8 sm:h-8 mb-2 text-muted-foreground/70" />
                    <p className="text-xs sm:text-sm font-medium text-center">Click to select CSV file</p>
                    <p className="text-xs text-muted-foreground text-center">or drag and drop here</p>
                  </label>
                </div>
                {file && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 bg-muted/30 p-1.5 px-2 rounded-md">
                    <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{file.name}</span>
                    <span className="flex-shrink-0">({Math.round(file.size / 1024)} KB)</span>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">2. Process & Verify Certificates</Label>
                <div className="flex flex-col gap-2">
                  <Button 
                    onClick={processAndVerifyCsv} 
                    disabled={!file || isProcessing || verifying}
                    className="w-full h-10 text-xs sm:text-sm"
                    variant={file ? "default" : "outline"}
                  >
                    {isProcessing || verifying ? (
                      <>
                        <div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        {verifying ? (
                          <>
                            <span className="hidden sm:inline">Verifying Certificates ({verificationProgress}%)</span>
                            <span className="sm:hidden">Verifying ({verificationProgress}%)</span>
                          </>
                        ) : (
                          "Processing Format..."
                        )}
                      </>
                    ) : (
                      <>
                        <FileCheck className="w-4 h-4 mr-2" />
                        Verify Certificates
                      </>
                    )}
                  </Button>
                </div>
                {verifying && (
                  <div className="w-full bg-muted/30 h-1.5 rounded-full mt-2">
                    <div 
                      className="bg-primary h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${verificationProgress}%` }}
                    ></div>
                  </div>
                )}
              </div>
            </div>
            {/* {summary && (
              <Alert variant="default" className="bg-muted/20 border-muted-foreground/20">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <FileCheck className="h-4 w-4" />
                  <span className="font-medium text-xs sm:text-sm">Processing completed. Ready for database verification.</span>
                </div>
              </Alert>
            )} */}
          </div>
        </div>


        {/* Scrollable Content Area */}
        <div className="flex-1 max-h-[60vh] overflow-auto">
          <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6">
            {/* Error Display */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs sm:text-sm">{error}</AlertDescription>
              </Alert>
            )}

            {/* Summary */}
            {summary && (
              <div>
                <h3 className="text-sm sm:text-base font-semibold mb-3 break-words">Certificate Summary</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 overflow-x-auto">
                  <Card className="min-w-0">
                    <CardContent className="flex items-center gap-1 sm:gap-2 p-2 sm:p-3">
                      <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm sm:text-lg font-bold truncate">{summary.total}</div>
                        <div className="text-xs text-muted-foreground truncate">Total Records</div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="min-w-0">
                    <CardContent className="flex items-center gap-1 sm:gap-2 p-2 sm:p-3">
                      <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-chart-5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm sm:text-lg font-bold text-chart-5 truncate">{summary.verified}</div>
                        <div className="text-xs text-muted-foreground truncate">Verified</div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="min-w-0">
                    <CardContent className="flex items-center gap-1 sm:gap-2 p-2 sm:p-3">
                      <XCircle className="w-4 h-4 sm:w-5 sm:h-5 text-chart-6 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm sm:text-lg font-bold text-chart-6 truncate">{summary.mismatchedData}</div>
                        <div className="text-xs text-muted-foreground truncate">Mismatched Data</div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="min-w-0">
                    <CardContent className="flex items-center gap-1 sm:gap-2 p-2 sm:p-3">
                      <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-destructive flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm sm:text-lg font-bold text-destructive truncate">{summary.invalidFormat}</div>
                        <div className="text-xs text-muted-foreground truncate">Invalid/Not Found</div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className={`min-w-0 ${summary.totalHours > 0 ? "" : "opacity-60"}`}>
                    <CardContent className="flex items-center gap-1 sm:gap-2 p-2 sm:p-3">
                      <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-chart-3 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm sm:text-lg font-bold text-chart-3 truncate">{summary.totalHours.toFixed(1)}</div>
                        <div className="text-xs text-muted-foreground truncate">Total Hours</div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className={`min-w-0 ${summary.certifiedCount > 0 ? "" : "opacity-60"}`}>
                    <CardContent className="flex items-center gap-1 sm:gap-2 p-2 sm:p-3">
                      <CircleCheck className="w-4 h-4 sm:w-5 sm:h-5 text-chart-4 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm sm:text-lg font-bold text-chart-4 truncate">{summary.certifiedCount}</div>
                        <div className="text-xs text-muted-foreground truncate">Certified</div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {/* Results */}
            {results.length > 0 && (
              <div className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm sm:text-base font-semibold break-words flex-1 min-w-0">
                    Record Details ({results.length} record{results.length === 1 ? '' : 's'})
                  </h3>
                </div>

                {/* Mobile View - Cards */}
                <div className="block xl:hidden space-y-3">
                  <div className="space-y-3">
                    {results.map((row, index) => (
                      <Card key={index} className={
                        !row.valid ? "border-destructive/50 bg-destructive/5" : 
                        row.isVerified ? "border-chart-5/50 bg-chart-5/10" :
                        row.verificationStatus === 'verified' && !row.isVerified ? "border-chart-6/50 bg-chart-6/10" :
                        row.verificationStatus === 'failed' ? "border-destructive/50 bg-destructive/10" : ""
                      }>
                        <Collapsible>
                          <CollapsibleTrigger asChild>
                            <div className="p-3 cursor-pointer hover:bg-muted/50 rounded-t-lg max-w-full">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  {!row.valid ? (
                                    <Badge variant="destructive" className="text-xs h-5 px-1.5 flex-shrink-0">
                                      <XCircle className="w-3 h-3 flex-shrink-0" />
                                      <span className="ml-1">Invalid Format</span>
                                    </Badge>
                                  ) : !row.verificationStatus ? (
                                    <Badge variant="secondary" className="text-xs h-5 px-1.5 flex-shrink-0">
                                      <CheckCircle className="w-3 h-3" />
                                      <span className="ml-1">Valid Format</span>
                                    </Badge>
                                  ) : row.verificationStatus === 'pending' ? (
                                    <Badge variant="outline" className="text-xs h-5 px-1.5 flex items-center flex-shrink-0">
                                      <div className="w-3 h-3 mr-1 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                      <span className="ml-1">Checking...</span>
                                    </Badge>
                                  ) : row.isVerified ? (
                                    <Badge variant="default" className="text-xs h-5 px-1.5 bg-chart-5 flex-shrink-0">
                                      <CheckCircle className="w-3 h-3" />
                                      <span className="ml-1">Verified</span>
                                    </Badge>
                                  ) : row.verificationStatus === 'verified' && !row.isVerified ? (
                                    <Badge variant="outline" className="text-xs h-5 px-1.5 border-chart-6 text-chart-6 flex-shrink-0">
                                      <XCircle className="w-3 h-3" />
                                      <span className="ml-1">Data Mismatch</span>
                                    </Badge>
                                  ) : row.verificationStatus === 'failed' ? (
                                    <Badge variant="destructive" className="text-xs h-5 px-1.5 flex-shrink-0">
                                      <XCircle className="w-3 h-3" />
                                      <span className="ml-1">Not Found</span>
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-xs h-5 px-1.5 flex-shrink-0">
                                      <CheckCircle className="w-3 h-3" />
                                      <span className="ml-1">Unknown</span>
                                    </Badge>
                                  )}
                                  
                                  <p className="text-sm font-medium truncate" title={row.projectTitle}>
                                    {row.projectTitle || 'Untitled Project'}
                                  </p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-muted-foreground transform transition-transform ui-open:rotate-90 flex-shrink-0" />
                              </div>
                              <div className="flex items-center justify-between mt-1">
                                <p className="text-xs text-muted-foreground font-mono truncate" title={row.certificateId}>
                                  ID: {row.certificateId || '-'}
                                </p>
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="px-3 pb-3 pt-2 space-y-3 border-t bg-background">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 text-xs">
                                <div>
                                  <span className="font-medium text-muted-foreground">Organization:</span>
                                  <p className="mt-0.5">{row.organizationName || 'N/A'}</p>
                                </div>
                                <div>
                                  <span className="font-medium text-muted-foreground">Organizer:</span>
                                  <p className="mt-0.5">{row.organizerName || '-'}</p>
                                </div>
                                {row.certificationStatus && (
                                  <div>
                                    <span className="font-medium text-muted-foreground">Status:</span>
                                    <div className="mt-0.5">
                                      <Badge 
                                        variant={row.certificationStatus === 'Certified' ? 'default' : 'secondary'}
                                        className="text-xs"
                                      >
                                        {row.certificationStatus}
                                      </Badge>
                                    </div>
                                  </div>
                                )}
                                {row.duration && (
                                  <div>
                                    <span className="font-medium text-muted-foreground">Duration:</span>
                                    <p className="mt-0.5">{row.duration}h</p>
                                  </div>
                                )}
                              </div>
                              
                              {row.verificationResult?.valid && row.verificationResult?.verification?.matches && (
                                <div className="mt-3">
                                  <h4 className="text-xs font-medium mb-2">Field Verification Results:</h4>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                    {Object.entries(row.verificationResult.verification.matches).map(([key, value]) => (
                                      <div key={key} className="flex items-center">
                                        {value ? (
                                          <CheckCircle className="w-3 h-3 text-chart-5 mr-1.5 flex-shrink-0" />
                                        ) : (
                                          <XCircle className="w-3 h-3 text-chart-6 mr-1.5 flex-shrink-0" />
                                        )}
                                        <span className="capitalize">
                                          {key === 'certificateId' ? 'Certificate ID' :
                                           key === 'title' ? 'Project Title' :
                                           key === 'organizer' ? 'Organizer Name' :
                                           key === 'hours' ? 'Duration/Hours' :
                                           key === 'status' ? 'Certification Status' :
                                           key.replace(/([A-Z])/g, ' $1').trim()}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                  {row.isVerified ? (
                                    <div className="mt-2 p-2 bg-chart-5/10 border border-chart-5/20 rounded-md">
                                      <p className="text-xs text-chart-5 font-medium">
                                        ✅ Perfect Match: All data verified successfully
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="mt-2 p-2 bg-chart-6/10 border border-chart-6/20 rounded-md">
                                      <p className="text-xs text-chart-6 font-medium">
                                        ⚠️ Data Mismatch: Some fields don&apos;t match our database records
                                      </p>
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              {row.verificationStatus === 'failed' && (
                                <div className="mt-3">
                                  <div className="p-2 bg-destructive/10 border border-destructive/20 rounded-md">
                                    <p className="text-xs text-destructive font-medium">
                                      ❌ Certificate not found in our database
                                    </p>
                                    {row.verificationResult?.error && (
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Error: {row.verificationResult.error}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                              
                              {row.issues.length > 0 && (
                                <div>
                                  <span className="font-medium text-destructive text-xs">Format Issues:</span>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {row.issues.map((issue, i) => (
                                      <Badge key={i} variant="destructive" className="text-xs font-normal">
                                        {issue}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* Desktop View - Table */}
                <div className="hidden xl:block">
                  <Card>
                    <div className="overflow-x-auto">
                      <Table className="min-w-[900px]">
                        <TableHeader className="sticky top-0 z-10">
                          <TableRow>
                            <TableHead className="w-[120px]">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help text-xs sm:text-sm">Format Status</span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Shows if the CSV data format is valid and if the certificate exists in our database</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </TableHead>
                            <TableHead className="min-w-[200px] flex-1">
                              <span className="text-xs sm:text-sm">Project Title</span>
                            </TableHead>
                            <TableHead className="w-[130px]">
                              <span className="text-xs sm:text-sm">Organization</span>
                            </TableHead>
                            <TableHead className="w-[130px]">
                              <span className="text-xs sm:text-sm">Organizer</span>
                            </TableHead>
                            <TableHead className="w-[80px]">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help text-xs sm:text-sm">Hours</span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Volunteer hours spent on this project</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </TableHead>
                            <TableHead className="w-[120px]">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help text-xs sm:text-sm">Certification</span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>&quot;Certified&quot; means the hours are officially recognized. &quot;Participated&quot; means attendance without certification.</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {results.map((row, index) => (
                            <TableRow 
                              key={index} 
                              className={
                                !row.valid ? "bg-destructive/5 hover:bg-destructive/10" : 
                                row.isVerified ? "bg-chart-5/10 hover:bg-chart-5/20" :
                                row.verificationStatus === 'failed' ? "bg-destructive/10 hover:bg-destructive/20" :
                                "hover:bg-muted/50"
                              }
                            >
                              <TableCell>
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div>
                                        {!row.valid ? (
                                          <Badge variant="destructive" className="text-xs">
                                            <XCircle className="w-3 h-3 mr-1 flex-shrink-0" />
                                            Invalid Format
                                          </Badge>
                                        ) : row.verificationStatus === 'pending' ? (
                                          <Badge variant="outline" className="text-xs">
                                            <div className="w-3 h-3 mr-1 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                            Checking...
                                          </Badge>
                                        ) : row.isVerified ? (
                                          <Badge variant="default" className="text-xs bg-chart-5">
                                            <CheckCircle className="w-3 h-3 mr-1" />
                                            Verified
                                          </Badge>
                                        ) : row.verificationStatus === 'verified' ? (
                                          <Badge variant="outline" className="text-xs border-chart-6 text-chart-6">
                                            <XCircle className="w-3 h-3 mr-1 flex-shrink-0" />
                                            Data Mismatch
                                          </Badge>
                                        ) : row.verificationStatus === 'failed' ? (
                                          <Badge variant="destructive" className="text-xs">
                                            <XCircle className="w-3 h-3 mr-1" />
                                            Not Found
                                          </Badge>
                                        ) : (
                                          <Badge variant="secondary" className="text-xs">
                                            <CheckCircle className="w-3 h-3 mr-1 flex-shrink-0" />
                                            Valid Format
                                          </Badge>
                                        )}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {!row.valid ? (
                                        <div>
                                          <div className="font-medium mb-1">Format Issues:</div>
                                          <ul className="list-disc pl-4 space-y-0.5">
                                            {row.issues.map((issue, i) => <li key={i} className="text-xs">{issue}</li>)}
                                          </ul>
                                        </div>
                                      ) : row.isVerified ? (
                                        <p>Certificate exists and all data matches perfectly</p>
                                      ) : row.verificationStatus === 'verified' ? (
                                        <div>
                                          <div className="font-medium mb-1">Data Comparison:</div>
                                          {row.verificationResult?.verification?.matches && (
                                            <ul className="space-y-1">
                                              <li className="flex items-center gap-1">
                                                {row.verificationResult.verification.matches.title ? 
                                                  <CheckCircle className="w-3 h-3 text-chart-5" /> : 
                                                  <XCircle className="w-3 h-3 text-destructive" />
                                                }
                                                <span className="text-xs">Title match</span>
                                              </li>
                                              <li className="flex items-center gap-1">
                                                {row.verificationResult.verification.matches.organizer ? 
                                                  <CheckCircle className="w-3 h-3 text-chart-5" /> : 
                                                  <XCircle className="w-3 h-3 text-destructive" />
                                                }
                                                <span className="text-xs">Organizer match</span>
                                              </li>
                                              <li className="flex items-center gap-1">
                                                {row.verificationResult.verification.matches.hours ? 
                                                  <CheckCircle className="w-3 h-3 text-chart-5" /> : 
                                                  <XCircle className="w-3 h-3 text-destructive" />
                                                }
                                                <span className="text-xs">Hours match</span>
                                              </li>
                                              <li className="flex items-center gap-1">
                                                {row.verificationResult.verification.matches.status ? 
                                                  <CheckCircle className="w-3 h-3 text-chart-5" /> : 
                                                  <XCircle className="w-3 h-3 text-destructive" />
                                                }
                                                <span className="text-xs">Certification status match</span>
                                              </li>
                                            </ul>
                                          )}
                                        </div>
                                      ) : row.verificationStatus === 'failed' ? (
                                        <p>Certificate ID not found in our database</p>
                                      ) : (
                                        <p>Data format is valid. Click verify to check against database.</p>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </TableCell>
                              <TableCell>
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="truncate cursor-default text-xs sm:text-sm" title={row.projectTitle}>
                                        {row.projectTitle || '-'}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="max-w-xs">{row.projectTitle}</p>
                                      {row.certificateId && (
                                        <p className="text-xs text-muted-foreground mt-1 font-mono">ID: {row.certificateId}</p>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </TableCell>
                              <TableCell>
                                <div className="truncate text-xs sm:text-sm" title={row.organizationName}>
                                  {row.organizationName || 'N/A'}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="truncate text-xs sm:text-sm" title={row.organizerName}>
                                  {row.organizerName || '-'}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs sm:text-sm font-medium">
                                {row.duration ? `${row.duration}h` : '-'}
                              </TableCell>
                              <TableCell>
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div>
                                        {row.certificationStatus ? (
                                          <Badge 
                                            variant={row.certificationStatus === 'Certified' ? 'default' : 'secondary'}
                                            className={`text-xs ${row.certificationStatus === 'Certified' ? 'bg-chart-4 hover:bg-chart-4/80' : ''}`}
                                          >
                                            {row.certificationStatus === 'Certified' ? (
                                              <CircleCheck className="w-3 h-3 mr-1" />
                                            ) : (
                                              <CheckCircle className="w-3 h-3 mr-1" />
                                            )}
                                            {row.certificationStatus}
                                          </Badge>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">-</span>
                                        )}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {row.certificationStatus === 'Certified' ? (
                                        <p>These volunteer hours are officially certified and count toward service requirements</p>
                                      ) : row.certificationStatus === 'Participated' ? (
                                        <p>Participated in the event but hours are not officially certified</p>
                                      ) : (
                                        <p>No certification status specified</p>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>
                </div>
              </div>
            )}
            {/* Placeholder when no file is processed yet */}
            {!file && !error && results.length === 0 && (
              <div className="text-center text-muted-foreground py-8 sm:py-10">
                <div className="bg-muted/30 w-16 h-16 sm:w-24 sm:h-24 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText size={24} className="sm:w-9 sm:h-9 opacity-60" />
                </div>
                <p className="text-sm sm:text-lg font-medium">Upload a CSV file to begin verification</p>
                <p className="text-xs sm:text-sm max-w-md mx-auto mt-2">
                  The CSV should contain columns for Certificate ID, Project Title, Organization Name, 
                  Project Organizer Name, and Certification Status
                </p>
                <div className="mt-4 sm:mt-6">
                  <div className="inline-flex items-center justify-center gap-1 px-3 py-1 rounded-md bg-muted/30 text-xs text-muted-foreground">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="18" x="3" y="3" rx="2" />
                      <path d="M3 9h18" />
                      <path d="M3 15h18" />
                      <path d="M9 3v18" />
                      <path d="M15 3v18" />
                    </svg>
                    <span>Example CSV format</span>
                  </div>
                </div>
              </div>
            )}
            
            {file && !isProcessing && results.length === 0 && !error && !summary && (
              <div className="text-center text-muted-foreground py-8 sm:py-10">
                <div className="bg-muted/20 w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-dashed border-primary/30">
                  <Upload size={20} className="sm:w-8 sm:h-8 opacity-60 text-primary" />
                </div>
                <p className="text-sm sm:text-lg font-medium">File selected and ready for verification</p>
                <p className="text-xs sm:text-sm max-w-md mx-auto mt-2">
                  Click &quot;Verify Certificates&quot; to validate the file format and check certificates against our database
                </p>
              </div>
            )}
            
            {/* Display verification in progress */}
            {/* {verifying && (
              <div className="bg-muted/10 rounded-lg border p-4 sm:p-6 my-4">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="relative">
                    <svg viewBox="0 0 100 100" className="w-12 h-12 sm:w-14 sm:h-14 transform -rotate-90">
                      <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/20" />
                      <circle 
                        cx="50" 
                        cy="50" 
                        r="40" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="8" 
                        strokeDasharray={`${2 * Math.PI * 40}`}
                        strokeDashoffset={`${2 * Math.PI * 40 * (1 - verificationProgress / 100)}`}
                        className="text-primary transition-all duration-300"
                      />
                    </svg>
                    <span className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-xs sm:text-sm font-bold">
                      {verificationProgress}%
                    </span>
                  </div>
                  <div>
                    <h4 className="font-medium text-sm sm:text-base">Verifying Certificates</h4>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      Checking certificate {currentVerifyIndex + 1} of {results.filter(r => r.valid && r.certificateId).length}
                    </p>
                  </div>
                </div>
              </div>  
            )} */}
          </div>
        </div>

        {/* Action Buttons Footer */}
        <div className="border-t p-3 sm:p-4 lg:p-6 shrink-0 bg-muted/30">
          <div className="flex flex-col-reverse sm:flex-row justify-between items-center gap-3 sm:gap-4">
            <div className="text-xs text-muted-foreground text-center sm:text-left">
              {results.length > 0 && (
                <span>
                  {results.length} certificate{results.length !== 1 ? 's' : ''} processed
                  {summary?.verified ? `, ${summary.verified} verified` : ''}
                </span>
              )}
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto">
              <Button 
                variant="outline" 
                onClick={() => {
                  resetModal();
                  toast({
                    title: "Reset Complete",
                    description: "Form has been reset. You can now upload a new CSV file.",
                    variant: "default",
                  });
                }} 
                disabled={isProcessing || verifying} 
                className="w-full sm:w-auto text-xs sm:text-sm"
              >
                Reset
              </Button>
              <Button 
                variant={results.length > 0 ? "default" : "secondary"} 
                onClick={() => setIsOpen(false)} 
                className="w-full sm:w-auto text-xs sm:text-sm"
              >
                {results.length > 0 && summary?.verified ? 'Done' : 'Close'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
