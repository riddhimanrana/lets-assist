"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  formatHours,
  parseCsvLine,
  validateCertificateRow,
  verifyCertificateId,
} from "./csv-verification-logic";
import type {
  CertificateRow,
  CsvVerificationStep,
  CsvVerificationSummary,
} from "./csv-verification-types";

export const CSV_FILE_INPUT_ID = "csv-file";

/** State and handlers for the certificate CSV checker dialog. */
export function useCsvVerification() {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<CertificateRow[]>([]);
  const [summary, setSummary] = useState<CsvVerificationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [_currentVerifyIndex, setCurrentVerifyIndex] = useState<number>(-1);
  const [verificationProgress, setVerificationProgress] = useState<number>(0);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];

    // Reset any previous errors
    setError(null);
    setResults([]);
    setSummary(null);

    if (selectedFile && selectedFile.type === "text/csv") {
      setFile(selectedFile);
    } else if (selectedFile) {
      setError("Please select a valid CSV file");
      setFile(null);
      // Clear the input
      event.target.value = "";
    } else {
      setFile(null);
    }
  };

  const processAndVerifyCsv = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setVerifying(true);
    setVerificationProgress(0);

    try {
      const text = await file.text();
      const lines = text.split("\n").filter((line) => line.trim());

      if (lines.length < 2) {
        setError(
          "CSV file must contain at least a header row and one data row",
        );
        return;
      }

      const headers = parseCsvLine(lines[0]);
      const expectedHeaders = [
        "certificate id",
        "project title",
        "organization name",
        "project organizer name",
        "certification status",
        "certificate type",
        "event start date",
        "event end date",
        "duration",
        "location",
        "check in method",
        "volunteer name",
        "volunteer email",
        "issued date",
      ];

      // Check if required headers are present (case insensitive)
      const hasRequiredHeaders = expectedHeaders.every((expected) =>
        headers.some((header) => header.toLowerCase().includes(expected)),
      );

      if (!hasRequiredHeaders) {
        setError(
          "CSV must contain the expected certificate columns: Certificate ID, Project Title, Organization Name, Project Organizer Name, Certification Status, Certificate Type, Event Start Date, Event End Date, Duration, Location, Check In Method, Volunteer Name, Volunteer Email, Issued Date",
        );
        return;
      }

      const processedResults: CertificateRow[] = [];
      const seenCertificateIds = new Set<string>();
      const duplicateIds = new Set<string>();

      // Process rows until we hit the summary section
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();

        // Stop processing when we hit the summary section
        if (
          line.includes("=== SUMMARY ===") ||
          line.includes("===SUMMARY===")
        ) {
          break;
        }

        const row = parseCsvLine(line);
        if (row.some((cell) => cell.trim())) {
          // Skip empty rows
          const result = validateCertificateRow(row, headers);

          // Check for duplicates based on certificate ID
          if (result.certificateId) {
            const certificateId = result.certificateId.toLowerCase().trim();
            if (seenCertificateIds.has(certificateId)) {
              duplicateIds.add(certificateId);
              // Mark this row as invalid due to duplicate
              result.valid = false;
              result.issues.push("Duplicate certificate ID found in CSV");
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
        processedResults.forEach((row) => {
          if (
            row.certificateId &&
            duplicateIds.has(row.certificateId.toLowerCase().trim())
          ) {
            row.valid = false;
            if (!row.issues.includes("Duplicate certificate ID found in CSV")) {
              row.issues.push("Duplicate certificate ID found in CSV");
            }
          }
        });

        const duplicateCount = processedResults.filter(
          (row) =>
            row.certificateId &&
            duplicateIds.has(row.certificateId.toLowerCase().trim()),
        ).length;

        setError(
          `Found ${duplicateIds.size} duplicate certificate ID${duplicateIds.size > 1 ? "s" : ""} affecting ${duplicateCount} row${duplicateCount > 1 ? "s" : ""}. ` +
            `Please remove duplicate entries before proceeding with verification. ` +
            `Duplicate ID${duplicateIds.size > 1 ? "s" : ""}: ${Array.from(duplicateIds).join(", ")}`,
        );

        // Still show the results but don't proceed with verification
        setResults(processedResults);
        setSummary({
          total: processedResults.length,
          certifiedHours: 0,
          verifiedHours: 0,
          selfReportedHours: 0,
          totalHours: 0,
          invalidFormat: processedResults.filter((r) => !r.valid).length,
        });
        return;
      }

      setResults(processedResults);

      // Now verify certificates
      const validRows = processedResults.filter(
        (row) => row.valid && row.certificateId,
      );
      let certifiedHours = 0; // Let's Assist OFFICIAL (from verified orgs)
      let verifiedHours = 0; // Let's Assist PLATFORM (from Let's Assist projects)
      let selfReportedHours = 0; // Self-Reported
      let totalHours = 0;

      if (validRows.length > 0) {
        const updatedResults = [...processedResults];

        for (let i = 0; i < validRows.length; i++) {
          setCurrentVerifyIndex(i);
          const row = validRows[i];
          const index = processedResults.findIndex(
            (r) => r.certificateId === row.certificateId,
          );

          if (index !== -1) {
            // Update the row status to indicate verification is in progress
            updatedResults[index] = {
              ...updatedResults[index],
              verificationStatus: "pending",
            };
            setResults([...updatedResults]);

            // Verify the certificate
            const verifiedRow = await verifyCertificateId(
              row.certificateId,
              row,
            );

            if (verifiedRow) {
              updatedResults[index] = verifiedRow;
              setResults([...updatedResults]);

              // Update verification stats and categorize hours
              if (verifiedRow.isVerified) {
                const hours = verifiedRow.duration
                  ? parseFloat(verifiedRow.duration)
                  : 0;
                if (!isNaN(hours)) {
                  // Categorize based on certificate type and certified status
                  // Handle backward compatibility: treat "verified" as equivalent to "platform"
                  const rawCertType =
                    verifiedRow.verificationResult?.certificate?.type ||
                    "platform";
                  const certType =
                    rawCertType === "verified" ? "platform" : rawCertType;
                  const isCertified =
                    verifiedRow.verificationResult?.certificate?.certified ||
                    false;

                  if (certType === "platform" && isCertified) {
                    certifiedHours += hours; // Let's Assist OFFICIAL (from verified orgs)
                  } else if (certType === "platform") {
                    verifiedHours += hours; // Let's Assist PLATFORM (from Let's Assist projects)
                  } else if (certType === "self-reported") {
                    selfReportedHours += hours; // Self-Reported
                  }

                  totalHours += hours;
                }
              }
            }
          }

          // Update progress
          setVerificationProgress(
            Math.round(((i + 1) / validRows.length) * 100),
          );
        }

        setResults(updatedResults);
      }

      setSummary({
        total: processedResults.length,
        certifiedHours: certifiedHours,
        verifiedHours: verifiedHours,
        selfReportedHours: selfReportedHours,
        totalHours: totalHours,
        invalidFormat: processedResults.filter((r) => !r.valid).length,
      });

      if (processedResults.filter((r) => !r.valid).length > 0) {
        toast.error("Format issues found", {
          description: `${processedResults.filter((r) => !r.valid).length} records have format issues. Check the details below.`,
        });
      } else {
        toast.success("Verification complete", {
          description: `Processed ${processedResults.length} records, verified ${formatHours(totalHours)} total hours`,
        });
      }
    } catch {
      setError("Failed to process CSV file. Please check the file format.");
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
    const fileInput = document.getElementById("csv-file") as HTMLInputElement;
    if (fileInput) {
      fileInput.value = "";
    }
  };

  const isBusy = isProcessing || verifying;
  const step: CsvVerificationStep = isBusy
    ? "verify"
    : results.length > 0 || summary
      ? "results"
      : "upload";

  return {
    isOpen,
    setIsOpen,
    file,
    results,
    summary,
    error,
    isBusy,
    verifying,
    verificationProgress,
    step,
    handleFileChange,
    processAndVerifyCsv,
    resetModal,
  };
}
