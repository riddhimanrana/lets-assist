import { escapeHtml, escapeHtmlWithLineBreaks } from "@/lib/security/html";
import type { Project } from "@/types";
import { formatScheduleSlot, type OrganizerSignup } from "./signups-format";

/** Prints the approved and pending volunteers of each slot. */
export const printVolunteers = (
  project: Project | null,
  filteredSignupsBySlot: Record<string, OrganizerSignup[]>,
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

  // Generate HTML content for printing - only approved volunteers
  const printContent = `
    <div class="print-content">
    <style>
      @media print {
      body > *:not(#print-container) { display: none !important; }
      #print-container { display: block !important; font-family: Arial, sans-serif; margin: 10px; }
      h1 { font-size: 18px; margin-bottom: 5px; }
      h2 { font-size: 14px; margin: 10px 0 5px; }
      table { width: 100%; border-collapse: collapse; margin: 5px 0; }
      th, td { border: 1px solid #ddd; padding: 4px; font-size: 11px; text-align: left; vertical-align: top; }
      th { background-color: #f2f2f2; font-weight: bold; }
      .comment-cell { max-width: 200px; word-wrap: break-word; white-space: pre-wrap; }
      .no-print { display: none !important; }
      /* Removed page-break class */
      }
    </style>
    <h1>Approved Volunteers - ${safeProjectTitle}</h1>
    <div>Printed: ${printedAt}</div>
    ${Object.entries(filteredSignupsBySlot)
      .map(([slot, slotSignups]) => {
        // Filter for approved or pending (if pending should be printed)
        const approved = slotSignups.filter(
          (s) => s.status === "approved" || s.status === "pending",
        );
        const safeSlotLabel = project
          ? escapeHtml(formatScheduleSlot(project, slot))
          : escapeHtml(slot);
        return approved.length > 0
          ? `
      <div class="schedule-slot">
        <h2>${safeSlotLabel}</h2>
        <table>
        <thead><tr><th>Name</th><th>Type</th><th>Contact</th><th>Status</th>${project?.enable_volunteer_comments ? "<th>Comment</th>" : ""}</thead>
        <tbody>
          ${approved
            .map((s) => {
              const isRegistered = !!s.user_id;
              const name = isRegistered
                ? s.profile?.full_name
                : s.anonymous_signup?.name;
              const email = isRegistered
                ? s.profile?.email
                : s.anonymous_signup?.email;
              const phone = isRegistered
                ? s.profile?.phone
                : s.anonymous_signup?.phone_number;
              const type = isRegistered ? "Registered" : "Anonymous";
              const statusText =
                s.status === "pending" ? "Pending Confirmation" : "Approved";
              const comment = s.volunteer_comment || "—";
              const safeName = escapeHtml(name || "N/A");
              const safeEmail = escapeHtml(email || "N/A");
              const safePhone = phone
                ? `<br>${escapeHtml(phone.replace(/(\\d{3})(\\d{3})(\\d{4})/, "$1-$2-$3"))}`
                : "";
              const safeComment = escapeHtmlWithLineBreaks(comment);

              return `
            <tr>
              <td>${safeName}</td>
              <td>${escapeHtml(type)}</td>
              <td>${safeEmail}${safePhone}</td>
              <td>${escapeHtml(statusText)}</td>
              ${project?.enable_volunteer_comments ? `<td class="comment-cell">${safeComment}</td>` : ""}
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
    ${Object.entries(filteredSignupsBySlot).every(([_, slotSignups]) => slotSignups.filter((s) => s.status === "approved" || s.status === "pending").length === 0) ? "<p>No approved or pending volunteers found.</p>" : ""}
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
