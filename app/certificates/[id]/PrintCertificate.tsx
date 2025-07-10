"use client";

import {
  Printer,
  Calendar,
  Clock,
  MapPin,
  Building2,
  Award,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useEffect, useState, useRef } from "react";

interface CertificateData {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  event_start: string;
  event_end: string;
  volunteer_email: string | null;
  user_id: string | null;
  check_in_method: string;
  created_at: string | null;
  organization_name: string | null;
  project_id: string | null;
  schedule_id: string | null;
  issued_at: string;
  signup_id: string | null;
  volunteer_name: string | null;
  project_location: string | null;
  durationText: string;
  issuedDate: string;
  eventStart: string;
  eventEnd: string;
  userTimezone: string;
}

export function PrintCertificate({ data }: { data: CertificateData }) {
  const [mounted, setMounted] = useState(false);
  const printCanceledRef = useRef(false);

  // Ensure component is mounted before rendering to avoid hydration issues
  useEffect(() => {
    setMounted(true);
  }, []);

  // Helper function to get user's timezone (client-side)
  const getUserTimezone = () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  };

  const handlePrint = () => {
    // Reset the flags at the start of each print attempt
    printCanceledRef.current = false;

    // Collect current stylesheets
    const links = Array.from(document.querySelectorAll("link[rel=stylesheet]"))
      .map((link) => link.outerHTML)
      .join("");

    // Assemble the HTML content for the certificate
    const certificateHtml = `
      <html>
        <head>
          <title>Certificate</title>
          ${links}
          <style>
            @page { size: landscape; margin: 0 }
            body { margin: 0; padding: 0; }
            .print-certificate { width:100vw; height:100vh; display:flex; flex-direction:column; padding: 2rem; box-sizing:border-box; }
            .print-header { display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #22c55e; padding-bottom:1rem; }
            .print-text { color:#000; }
            .print-accent { color:#22c55e; }
            .print-body { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; }
            .print-footer { display:flex; justify-content:space-between; border-top:2px solid #22c55e; padding-top:1rem; }
          </style>
        </head>
        <body>
          <div class="print-certificate">
            <div class="print-header">
              <div style="display:flex;align-items:center">
                <img src="/logo.png" alt="Let's Assist Logo" width="64" height="64" style="margin-right:1rem" />
                <div>
                  <h1 style="font-size:2rem;margin:0" class="print-text">Certificate of Volunteer Service</h1>
                  <p style="margin:0" class="print-text">Let's Assist</p>
                </div>
              </div>
              <div style="text-align:right">
                <p class="print-text" style="margin:0">Certificate ID: ${data.id}</p>
                <p class="print-text" style="margin:0">Issued: ${data.issuedDate}</p>
              </div>
            </div>

            <div class="print-body">
              <p class="print-text" style="font-size:1.25rem">This certifies that</p>
              <h2 class="print-text print-accent" style="font-size:2.5rem;margin:0 0 1rem;border-bottom:2px solid #22c55e;padding-bottom:.5rem">
                ${data.volunteer_name || "Unnamed Volunteer"}
              </h2>
              <p class="print-text" style="font-size:1.25rem;margin:1rem 0">has successfully completed</p>
              <p class="print-text print-accent" style="font-size:2rem;margin:0">
                ${data.durationText}
              </p>
              <p class="print-text" style="margin:.5rem 0">of volunteer service for</p>
              <h3 class="print-text" style="font-size:1.75rem;margin:0 0 1rem">
                ${data.project_title}
              </h3>
              <div style="display:flex;gap:2rem;margin-top:1rem">
              <div style="text-align:center">
                <span class="print-accent" aria-hidden="true">📅</span>
                <p class="print-text" style="margin:.5rem 0">${formatInTimeZone(parseISO(data.event_start), getUserTimezone(), "MMMM d, yyyy")}</p>
                <p class="print-text" style="margin:0;font-size:0.9rem;">Event Date</p>
              </div>
                ${
                  data.organization_name
                    ? `
                <div style="text-align:center">
                  <span class="print-accent" aria-hidden="true">🏢</span>
                  <p class="print-text" style="margin:.5rem 0">${data.organization_name}</p>
                  <p class="print-text" style="margin:0;font-size:0.9rem;">Organization</p>
                </div>`
                    : ""
                }
                ${
                  data.project_location
                    ? `
                <div style="text-align:center">
                  <span class="print-accent" aria-hidden="true">📍</span>
                  <p class="print-text" style="margin:.5rem 0">${data.project_location}</p>
                  <p class="print-text" style="margin:0;font-size:0.9rem;">Location</p>
                </div>`
                    : ""
                }
                <div style="text-align:center">
                  <span class="print-accent" aria-hidden="true">⏰</span>
                  <p class="print-text" style="margin:.5rem 0">${data.durationText}</p>
                  <p class="print-text" style="margin:0;font-size:0.9rem;">Duration</p>
                </div>
              </div>
            </div>

            <div class="print-footer">
              <div>
                <p class="print-text" style="margin:0">Issued by:</p>
                <p class="print-text" style="font-weight:bold;margin:.25rem 0">${data.creator_name || "Let's Assist Admin"}</p>
              </div>
              ${
                data.is_certified
                  ? `
              <div style="display:flex;align-items:center">
                <span class="print-accent" aria-hidden="true" style="font-size:2rem;">🏅</span>
                <span class="print-text print-accent" style="font-weight:bold;margin-left:.5rem">OFFICIALLY VERIFIED</span>
              </div>`
                  : ""
              }
              <div style="text-align:right">
                <p class="print-text" style="margin:0">Verify at:</p>
                <p class="print-text" style="font-weight:bold;margin:.25rem 0">lets-assist.com/certificates/${data.id}</p>
              </div>
            </div>
          </div>
          <script>
            window.onload = () => { window.print(); window.onafterprint = () => window.close(); }
          </script>
        </body>
      </html>
    `;

    // Create an iframe
    const iframe = document.createElement("iframe");
    iframe.style.position = "absolute";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden"; // Hide the iframe
    iframe.src = "about:blank"; // Set src to avoid potential browser issues

    document.body.appendChild(iframe);

    // Cleanup function
    const cleanup = () => {
      if (iframe.parentNode === document.body) {
        document.body.removeChild(iframe);
      }
    };

    // Write the HTML content to the iframe
    iframe.contentDocument?.open();
    iframe.contentDocument?.write(certificateHtml);
    iframe.contentDocument?.close();

    // Handle print attempt
    const attemptPrint = () => {
      if (printCanceledRef.current) {
        cleanup();
        return;
      }

      try {
        if (iframe.contentWindow) {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();

          // Set up cancel detection
          const checkPrintDialog = setInterval(() => {
            if (document.hasFocus()) {
              clearInterval(checkPrintDialog);
              printCanceledRef.current = true;
              cleanup();
            }
          }, 50);

          // Clear interval after 5s maximum
          setTimeout(() => {
            clearInterval(checkPrintDialog);
            cleanup();
          }, 50);
        }
      } catch (error) {
        console.error("Printing failed:", error);
        alert(
          "Could not open print dialog. Please try again or check browser settings.",
        );
        cleanup();
      }
    };

    // Wait for iframe to load before printing
    iframe.onload = attemptPrint;

    // Cleanup if something goes wrong
    setTimeout(cleanup, 10000); // Failsafe cleanup after 10 seconds
  };

  if (!mounted) return null;

  return (
    <>
      {/* Print Button */}
      <Button
        onClick={handlePrint}
        variant="outline"
        size="sm"
        className="flex items-center gap-2 mt-6 mx-auto print:hidden hover:bg-primary/10 transition-colors"
        aria-label="Print certificate"
      >
        <Printer className="h-4 w-4" />
        Print Certificate
      </Button>

      {/* Printable Certificate structure (can be kept for reference or removed if not needed elsewhere) */}
      {/* This div is NOT used by the iframe print method */}
      <div className="printable-certificate hidden" aria-hidden="true">
        {/* ... existing certificate structure ... */}
        {/* This content is now generated dynamically in the handlePrint function */}
      </div>
    </>
  );
}
