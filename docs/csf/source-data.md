# CSF real source data — layout and semantics

`docs/csf/source-data/` holds the chapter's **real** legacy spreadsheets and mail used to seed DVHS CSF history. The directory is git-ignored (`/docs/csf/source-data/` in `.gitignore`) because every file contains real student PII. This document is the committed, sanitized description of that data so agents and tooling always have the context without the files being in git.

**Rules (enforced by `scripts/check-source-data-hygiene.test.ts`):**

- Files under `docs/csf/source-data/` are never committed, and workbook/mail formats (`.xlsx`, `.xls`, `.csv`, `.eml`, `.pdf`) under `docs/csf/` are only ever tracked inside `docs/csf/evidence/` or `docs/csf/reference/` (curated, synthetic).
- Agents may read these files locally for context and to run import tooling. Real values (names, emails, IDs) must never be copied into code, fixtures, tests, docs, migrations, seeds, or commit messages. Fixtures stay fictional.
- Tooling reads the directory via the `CSF_SOURCE_DATA_DIR` env var, defaulting to `docs/csf/source-data`. Generated outputs (normalized workbooks, inspection reports, mapping drafts) go to `.artifacts/legacy-csf/`, never back into this directory.

If the directory is missing locally, ask the chapter web master (repo owner) for the files; nothing in CI depends on them.

## Directory layout

```
docs/csf/source-data/
  rosters/   # chapter-level workbooks (applications, attendance, club registry)
  mail/      # officer correspondence (acceptance email as .eml + PDF export)
  clubs/     # 21 per-club Fall 2025 point-audit workbooks (formats vary wildly)
```

## Semantics and era mapping

- Grade → cohort at Spring 2026: 9th → Class of 2029, 10th → 2028, 11th → 2027, 12th → Class of 2026 (out of scope; do not import).
- School emails look like `2xxxxx@students.srvusd.net` (6-digit student number). Personal emails are free-form. The application workbook carries both; most club sheets carry one or neither.
- "Points" are CSF service points (typically 1 point per attended club meeting, 2 per non-drive event per the club registry), not volunteer hours.
- Import targets: partner clubs from the returning-club/audit form responses (each previewed row applied as a draft club record or skipped; per-club point policy is no longer imported); the approved Class of 2027–2029 `S26` sheets are historical records; attendance sheets become term-scoped attendance records with `source='sheet'` provenance, while per-club point workbooks are manual reference evidence for point vetting rather than an import target. The Spring 2026 application workbook is historical comparison evidence for this cutover, not the roster seed or account-connection evidence. The template-only Class of 2030 workbook is skipped; 2030 student records come through the new application cycle.

## rosters/

### CSF Application Spring 2026 Responses.xlsx — historical comparison source

One sheet (`Form Responses 1`), 517 data rows, Google Forms export. Columns:

| Column                                                        | Notes                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Timestamp                                                     | Form submission time                                                                      |
| Email Address                                                 | Auth email of submitter — often the school address                                        |
| Last Name / First Name                                        | Separate columns                                                                          |
| Most Frequently Checked Email                                 | Personal email; the better contact channel                                                |
| Current Grade Level                                           | Numeric 9–12 (float-formatted, e.g. `10.0`)                                               |
| Returning or New Member                                       | Literal strings `Returning Member` / `New Member`                                         |
| Shirt Sizing                                                  | Often blank                                                                               |
| List I / II / III Courses                                     | Multi-line text, one course per line as `Course, Grade, Points` (e.g. `English 10, A, 3`) |
| Total Points - List I / List I & II / Grand Total - All Lists | Claimed totals (floats)                                                                   |
| Transcript Copy                                               | Google Drive open-URL                                                                     |

### CSF March Meeting Attendance 2025.xlsx

One sheet, 354 rows, **no header row** — column A = first name, column B = last name (sometimes both names end up in column A). Name-only matching; expect ambiguous/skipped rows. Term: Spring 2025, single chapter meeting (March 2025).

### Clubs Points.xlsx — partner-club point policy registry

One sheet, header + 32 club rows:

| Column           | Notes                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Club             | Club name (short/informal — needs alias matching against audit forms) |
| Point - nondrive | Points per non-drive event (float, typically `2.0`)                   |
| ATTENDENCE       | (sic) boolean — whether the club tracks attendance                    |
| PHOTOS + HOURS   | boolean — whether photos+hours evidence was provided                  |

### CSF Club Audit Spring 2026 Responses.xlsx

`Form Responses 1`, 31 data rows. Google Forms export: Timestamp, Email Address, officer Name (Last, First), Advisor Name, Club, club type (`Volunteering Service` / `Academic/Extracurricular Enrichment` / …), points duration (Full-Year vs Semester), prior-year standing, point-allocation description, tracking method (invariably "Google Sheets"), approval justification, out-of-school events (Y/N), outside drives (Y/N), logistics detail.

### Spring 2025 CSF Returning Clubs Responses.xlsx

`Form Responses 1`, 26 data rows. Prior-year returning-club form: Timestamp, Email Address, Club Name, continue-partnership (Y/N), club email, President(s) (Last, First), Advisor (Last, First), recruiting new members (Y/N), description, Instagram asset link, satisfaction with current standing (Y/N + detail), comments.

## mail/

`Club Audit Acceptance.eml` (+ `Gmail - Club Audit Acceptance.pdf`, same content): the officer acceptance email BCC'd to ~30 club contacts from `dvhighcsf@gmail.com`. Documents the operating model being replaced: per-club Google Sheets point tracking, photo evidence requirements, and the four Google Classroom class codes (Freshman/Sophomore/Junior/Senior) that the permanent class join codes supersede.

## clubs/ — 21 per-club Fall 2025 audit workbooks

Every club invented its own format. Common denominators: a member-name column (sometimes split first/last, sometimes combined, order varies), optional grade/email, per-meeting attendance marks, and often a total-points column. Recurring traps:

- Header row is not always row 0 (e.g. one file has a junk row 0 with the real header in row 1; another puts a legend in column A).
- Attendance marks vary: `True`/`False` booleans, `Yes`/`No`, `X`, or a date value in the cell.
- Some sheets have 995–1000 phantom rows (formatting-extended ranges) with only a few dozen real rows.
- Extra sheets abound: meeting agendas, form responses, statistics, mentor/mentee splits, pairing tables, prior-year (Fall 24) tabs that must be ignored for Fall 25 credit.
- Points appear as floats (`3.0`), strings (`"2 points"`), or must be derived from attendance counts (1 point/meeting).

Per-file shape (sheet → meaning; only sheets relevant to Fall 25 credit listed as **credit-bearing**):

| File                                                | Credit-bearing sheet(s)                   | Shape notes                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| HOSA Card Drive.xlsx                                | `Sheet1`                                  | Name (combined), cards submitted, points (2 cards = 1 pt)                                                                                    |
| 2025-2026 Sem 1 Project Morph Audit.xlsx            | `Attendance`                              | Col A is a Yes/No legend, col B names, 3 meeting-date columns; `Meeting Agendas` sheet is context                                            |
| 25-26 Club Audits - Literacy Through Languages.xlsx | `Sheet1`                                  | Name + 10 dated meeting columns (full year); no points column — derive                                                                       |
| 25-26 Semester 1 Music Service Audits.xlsx          | `Sheet1`                                  | Name + 3 month columns **containing names, not marks** (columns misused); points as `"2 points"` strings                                     |
| Attendance 2025-26.xlsx (public-speaking mentoring) | `Mentors`, `Fall 25 - Mentees`            | Name + personal email + dated columns; Fall 24 tabs and `Pairings` are history/context, skip                                                 |
| DVI4C Club Audit 25-26 sem 1.xlsx                   | `Sheet1`                                  | Last, First, Grade, Email, 2 event YES/NO columns, total points, membership status                                                           |
| DVSA CSF Points 2025-2026.xlsx                      | `CSF Points`                              | First, Last, Grade, points; `Meeting Agendas` is context                                                                                     |
| FTY CSF PTS AUDIT Fall 25.xlsx                      | `csf pts list`                            | Header in **row 1** (row 0 junk); first, last, 3 boolean meeting cols, points; `Sheet2` empty                                                |
| FoodForThought Spreadsheet (CSF Audit).xlsx         | `Sheet1`                                  | Combined name in "Member First Name", email, 3 month attendance columns (blank = ambiguous)                                                  |
| GWC 2025 Attendance + CSF Points.xlsx               | `Attendance + Workshop Points`            | Row 0 is banner text; real header row 1: combined name + 7 meeting dates + 5 workshop dates, `Yes` marks; total at far right                 |
| Hearts4Hands Attendance Tracker.xlsx                | `attendance`                              | Combined name, 3 dated columns, summary text; ~1000 phantom rows                                                                             |
| Letters of Love CSF point tracker....xlsx           | `Sheet1`                                  | First, Last, 3 described-meeting columns (blank marks), points column authoritative                                                          |
| Petite Picassos Club Audits Fall 2025.xlsx          | `Sheet1`                                  | Combined name, `Attendance` cell holds a **date-like count artifact**, events + description text                                             |
| Project C.A.R.E. Fall 2025 CSF Audit.xlsx           | `Sheet1`                                  | First, Last, 3 boolean meeting columns, points                                                                                               |
| Sankara Eye Foundation CSF Club Audits.xlsx         | `Sheet1`                                  | First, Last, Active flag, Grade, points                                                                                                      |
| Spanish Club Audits Fall 25.xlsx                    | `Sheet1`                                  | Combined name, date-artifact attendance, events + description text                                                                           |
| Stitch a Smile Minutes_ Members....xlsx             | `Members Qualified for CSF point`         | Authoritative name+points sheet; `MinutesAttendance` (Yes/No per event) is evidence; roster/form sheets are context                          |
| TEAMWORKS CSF Points - Semester 1.xlsx              | `Sheet1`                                  | Combined name, grade, status, points                                                                                                         |
| TEDx CSF Points Audit Form....xlsx                  | `Member Info`                             | First, Last, Grade, Email, 3 meeting columns (`X` marks, sparsely filled), points; `MeetingsEvents` context                                  |
| TYME (CSF) Attendance 25-26_.xlsx                   | `Hour Log (Band)`, `Hour Log (Orchestra)` | Name, grade, hours S1/S2, derived points, active + qualify flags; `Form Responses 1` raw check-ins, `Statistics` context; ~1000 phantom rows |
| Virtual Tutors DVHS CSF points.xlsx                 | `Form Responses 1`                        | Junk `Column 1`/`Column 6` columns; combined name, grade, status, `"2 points"` strings                                                       |

When a workbook has both a points/total column and per-meeting marks, the points column is authoritative; derived attendance counts are evidence only.

The 2026-08-17 partner-clubs simplification removed the legacy workbook inspector, normalizer, and partner-audit upload path. These files are now reference material for manual point vetting, not an import payload; no repository command transforms or imports them.
