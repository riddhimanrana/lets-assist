import {
  paginateAttendanceRows,
  type AttendancePrintSheet,
} from "@/lib/attendance/print-types";

export function PrintableAttendanceSheets({
  sheets,
}: {
  sheets: AttendancePrintSheet[];
}) {
  return (
    <div className="attendance-print-sheets">
      {sheets.map((sheet) => {
        const pages = paginateAttendanceRows(sheet.rows);
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: sheet.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        });
        return pages.map((rows, pageIndex) => (
          <section
            className="attendance-print-page"
            key={`${sheet.sheetReference}-${pageIndex}`}
          >
            <header>
              <p className="attendance-print-eyebrow">
                Let&apos;s Assist attendance
              </p>
              <h2>{sheet.projectTitle}</h2>
              <p>
                <strong>{sheet.sessionLabel}</strong>
              </p>
              <p>
                {formatter.format(new Date(sheet.startsAt))} to{" "}
                {formatter.format(new Date(sheet.endsAt))}
              </p>
              <p>
                All times in {sheet.timezone}. Write AM or PM with each time.
              </p>
              <p className="attendance-print-reference">
                Sheet: {sheet.sheetReference} · Page {pageIndex + 1} of{" "}
                {pages.length}
              </p>
            </header>
            <table>
              <colgroup>
                <col className="attendance-col-reference" />
                <col className="attendance-col-name" />
                <col />
                <col />
                <col />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Row / reference</th>
                  <th scope="col">Volunteer</th>
                  <th scope="col">In 1</th>
                  <th scope="col">Out 1</th>
                  <th scope="col">In 2</th>
                  <th scope="col">Out 2</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowReference}>
                    <td>
                      <strong>{row.rowNumber}</strong>
                      <small>{row.rowReference}</small>
                    </td>
                    <td>
                      {row.rowKind === "signup" ? (
                        <strong>{row.name}</strong>
                      ) : row.rowKind === "walk_in" ? (
                        <>
                          <span>Name:</span>
                          <span className="attendance-email-line">Email:</span>
                        </>
                      ) : (
                        <>
                          <span>Continuation for row: ______</span>
                          <span className="attendance-email-line">Name:</span>
                        </>
                      )}
                    </td>
                    <td />
                    <td />
                    <td />
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
            <footer>
              <p>
                Returning volunteers: use the second in/out pair. For more
                visits, use a continuation row and copy your original row
                number.
              </p>
              <p>
                Walk-ins: print your name and email clearly. This sheet records
                attendance; any required waiver must be completed separately.
              </p>
              <p>
                Organizer: keep this sheet private. Scan all pages and review
                each row before saving attendance.
              </p>
            </footer>
          </section>
        ));
      })}
    </div>
  );
}
