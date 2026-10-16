"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  formatHours,
  parseCertificateCsv,
  summarizeVerifiedHours,
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
      const parsed = parseCertificateCsv(text);

      if (!("rows" in parsed)) {
        setError(parsed.error);
        return;
      }

      const processedResults = parsed.rows;
      const seenCertificateIds = new Set<string>();
      const duplicateIds = new Set<string>();

      for (const result of processedResults) {
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
      const updatedResults = [...processedResults];

      if (validRows.length > 0) {
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
            }
          }

          // Update progress
          setVerificationProgress(
            Math.round(((i + 1) / validRows.length) * 100),
          );
        }

        setResults(updatedResults);
      }

      // Hours come from the certificate records of fully verified rows, never
      // from the uploaded cells.
      const { certifiedHours, verifiedHours, selfReportedHours, totalHours } =
        summarizeVerifiedHours(updatedResults);
      const unavailableCount = updatedResults.filter(
        (r) => r.verificationStatus === "unavailable",
      ).length;

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
      } else if (unavailableCount > 0) {
        toast.warning("Verification incomplete", {
          description: `${unavailableCount} of ${processedResults.length} records could not be checked. Run the verification again.`,
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
