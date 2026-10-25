import { format, parseISO } from "date-fns";
import { escapeHtml } from "@/lib/security/html";
import type { Project } from "@/types";
import { formatSessionName, type Attendance } from "./attendance-format";

/** Prints the attendance record of every session currently in view. */
export const printAttendance = (
  project: Project | null,
  filteredAttendanceBySession: Record<string, Attendance[]>,
) => {
  // Create a hidden print-only container if it doesn't exist yet
  let printContainer = document.getElementById("print-container");
  if (!printContainer) {
    printContainer = document.createElement("div");
    printContainer.id = "print-container";
    printContainer.className = "hidden print:block";
    document.body.appendChild(printContainer);
  }

  const safeProjectTitle = escapeHtml(project?.title || "Project");
  const printedAt = escapeHtml(
    `${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
  );

  // Generate HTML content for printing
  const printContent = `
    <div class="print-content">
    <style>
      @media print {
      body > *:not(#print-container) { display: none !important; }
      #print-container { display: block !important; font-family: Arial, sans-serif; margin: 10px; color: black !important; }
      h1 { font-size: 18px; margin-bottom: 5px; }
      h2 { font-size: 14px; margin: 10px 0 5px; }
      table { width: 100%; border-collapse: collapse; margin: 5px 0; }
      th, td { border: 1px solid #ddd; padding: 4px; font-size: 12px; text-align: left; }
      th { background-color: #f2f2f2; }
      }
    </style>
    <h1>Attendance Record - ${safeProjectTitle}</h1>
    <div>Printed: ${printedAt}</div>
    ${Object.entries(filteredAttendanceBySession)
      .map(([session, sessionAttendance]) => {
        const safeSessionLabel = project
          ? escapeHtml(formatSessionName(project, session))
          : escapeHtml(session);
        return sessionAttendance.length > 0
          ? `
      <div class="session-attendance">
        <h2>${safeSessionLabel}</h2>
        <table>
        <thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Check-in Time</th><th>Check-out Time</th></tr></thead>
        <tbody>
          ${sessionAttendance
            .map((a) => {
              const isRegistered = !!a.user_id;
              const name = isRegistered
                ? a.profile?.full_name
                : a.anonymous_signup?.name;
              const email = isRegistered
                ? a.profile?.email
                : a.anonymous_signup?.email;
              const type = isRegistered ? "Registered" : "Anonymous";
              const checkInTime = a.check_in_time
                ? format(parseISO(a.check_in_time), "MMM d, yyyy h:mm a")
                : "N/A";
              const checkOutTime = a.check_out_time
                ? format(parseISO(a.check_out_time), "MMM d, yyyy h:mm a")
                : "N/A";
              const safeName = escapeHtml(name || "N/A");
              const safeEmail = escapeHtml(email || "N/A");

              return `
            <tr>
        <td>${safeName}</td>
        <td>${safeEmail}</td>
        <td>${escapeHtml(type)}</td>
        <td>${escapeHtml(checkInTime)}</td>
        <td>${escapeHtml(checkOutTime)}</td>
            </tr>
            `;
            })
            .join("")}
        </tbody>
        </table>
      </div>
      `
          : "";
      })
      .join("")}
    ${Object.keys(filteredAttendanceBySession).length === 0 ? "<p>No attendance records found.</p>" : ""}
    </div>
  `;

  // Set the content and trigger print
  if (printContainer) {
    printContainer.innerHTML = printContent;

    // Give the browser a moment to render the content before printing
    setTimeout(() => {
      window.print();
    }, 100);
  }
};
