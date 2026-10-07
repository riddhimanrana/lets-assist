import { endOfDay, format, parseISO, startOfDay } from "date-fns";

import { escapeHtml } from "@/lib/security/html";

import {
  calculateDecimalHours,
  formatTotalDuration,
  type CertificateWithHours,
  type DateFilter,
} from "./certificate-hours";

// Print all certificates in a clean, styled container
export function printCertificates({
  certificatesWithHours,
  filteredCertificates,
  dateFilter,
  startDate,
  endDate,
  user,
}: {
  certificatesWithHours: CertificateWithHours[];
  filteredCertificates: CertificateWithHours[];
  dateFilter: DateFilter;
  startDate: Date | undefined;
  endDate: Date | undefined;
  user: { name: string; email: string };
}) {
  // Calculate total hours on filtered results
  const totalHours = filteredCertificates.reduce(
    (sum, cert) => sum + cert.hours,
    0,
  );
  const totalDuration = formatTotalDuration(totalHours);
  const printedAt = `${new Date().toLocaleString()} ${(() => {
    try {
      return (
        new Intl.DateTimeFormat("en-US", {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          timeZoneName: "short",
        })
          .formatToParts(new Date())
          .find((part) => part.type === "timeZoneName")?.value || ""
      );
    } catch {
      return "";
    }
  })()}`.trim();
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
      <h1>All Certificates for ${escapeHtml(user.name)}</h1>
      <div>Email: ${escapeHtml(user.email)}</div>
      <div>Printed: ${escapeHtml(printedAt)}</div>
      <div><strong>Total Hours: ${escapeHtml(totalDuration)}</strong></div>
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
            .filter((cert) => {
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
            .map(
              (cert) => `
              <tr>
                <td>${escapeHtml(cert.project_title)}</td>
                <td>${escapeHtml(cert.organization_name || cert.creator_name || "-")}</td>
                <td>${escapeHtml(
                  `${format(parseISO(cert.issued_at), "MMM d, yyyy")} ${(() => {
                    const date = parseISO(cert.issued_at);
                    const timezone =
                      cert.projects?.project_timezone || "America/Los_Angeles";
                    try {
                      return (
                        new Intl.DateTimeFormat("en-US", {
                          timeZone: timezone,
                          timeZoneName: "short",
                        })
                          .formatToParts(date)
                          .find((part) => part.type === "timeZoneName")
                          ?.value || ""
                      );
                    } catch {
                      return "";
                    }
                  })()}`,
                )}</td>
                <td>${escapeHtml(formatTotalDuration(calculateDecimalHours(cert.event_start, cert.event_end)))}</td>
                <td>${escapeHtml(cert.is_certified ? "Yes" : "No")}</td>
              </tr>
            `,
            )
            .join("")}
        </tbody>
      </table>
      <p style="margin-top:12px;font-size:12px;color:#555;">
        Certified means this certificate comes from a verified organization checked by the Let’s Assist team.
      </p>`;

  container.innerHTML = content;
  setTimeout(() => window.print(), 100);
}
