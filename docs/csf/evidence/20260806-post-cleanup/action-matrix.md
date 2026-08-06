# DVHS CSF action matrix

This matrix maps the primary visible actions represented by the curated synthetic screenshots. `Captured` means the route and control are visible in the supplied evidence. Transactional and permission assertions belong to the automated suites, not to the screenshot alone.

Companion post-cleanup evidence: private-plugin isolation browser/API smoke passes; every officer-template navigation and direct-route boundary passes; the compiled-runtime CSF Playwright run passes 40 behavioral scenarios, intentionally skips only the 3 opt-in gallery captures, and has 0 failures. The separate sanitized gallery capture passes 3/3.

| Actor | Area | Visible action | Expected result | Screenshot | Evidence |
|---|---|---|---|---|---|
| Organization admin | Home | Open applications awaiting decision | Opens the filtered review queue | `40-home-admin.png` | Captured |
| Organization admin | Home | Open point submissions | Opens submissions awaiting verification | `40-home-admin.png` | Captured |
| Organization admin | Home | Open imported-row issues | Opens unresolved import rows | `40-home-admin.png` | Captured |
| Organization admin | Home | Open upcoming activities or required meetings | Opens the matching Service list | `40-home-admin.png` | Captured |
| Membership officer | Applications | Switch Review queue / All applications | Preserves the selected list state in the URL | `41-applications-list.png` | Captured |
| Membership officer | Applications | Search, filter, or sort | Returns a compact filtered list without a permanent split pane | `41-applications-list.png` | Captured |
| Membership officer | Applications | Open application row | Opens a URL-addressable full-page review | `41-applications-list.png` | Captured |
| Membership officer | Applications | Import applications | Opens the import workflow for application responses | `41-applications-list.png` | Captured |
| Membership officer | Application review | Return to applications | Restores list navigation context | `42-application-review.png` | Captured |
| Authorized reviewer | Application review | Inspect source files and courses | Shows scoped provenance, supporting-file state, calculations, and validation | `42-application-review.png` | Captured |
| Authorized reviewer | Application review | Recalculate eligibility | Re-evaluates against the semester policy and records the result | `42-application-review.png` | Captured |
| Authorized reviewer | Application review | Decide or request information | Enforces required checks and records an auditable state transition | `42-application-review.png` | Captured visually; transaction tested separately |
| Membership officer | Members | Search directory | Filters by name, email, class, or status | `43-members-directory.png` | Captured |
| Membership officer | Members | Open student | Opens the permanent member record | `43-members-directory.png` | Captured |
| Membership officer | Members | Review account connections | Opens exact/ambiguous profile-connection work | `43-members-directory.png` | Captured |
| Publicity/Activity officer | Activities | Create activity | Opens the structured CSF activity form | `44-service-activities.png` | Captured |
| Publicity/Activity officer | Activities | Open activity | Opens status, audience, signup, credit, evidence, and publication controls | `44-service-activities.png` | Captured |
| Member | Point submissions | Add point claim | Opens a claim against an allowed activity or club | `45-service-points.png` | Captured |
| Points reviewer | Point submissions | Review claim | Opens evidence and award decision controls | `45-service-points.png` | Captured |
| Points reviewer | Point submissions | Open policy | Opens the versioned semester requirement | `45-service-points.png` | Captured |
| Points reviewer | Appeals | Resolve reconsideration | Records an appeal decision without erasing the original claim | `45-service-points.png` | Captured empty state |
| Secretary | Meetings | Search or include history | Filters meeting records by semester/history | `46-service-meetings.png` | Captured |
| Secretary | Meetings | Attendance import | Opens exact Sheet tab/range mapping and reconciliation | `46-service-meetings.png` | Captured |
| Secretary | Meetings | Edit or archive | Updates meeting metadata or archives with history | `46-service-meetings.png` | Captured |
| VP Clubs | Partner clubs | Open club record | Shows semester standing, policy, source files, and reviewer state | `47-service-partner-clubs.png` | Captured |
| VP Clubs | Partner clubs | Review member Sheets | Opens unresolved club point evidence | `47-service-partner-clubs.png` | Captured |
| Adviser/Admin | Semester | Add deadline | Creates a typed, officer-owned semester deadline | `48-semester.png` | Captured |
| Adviser/Admin | Semester | Edit schedule or policy | Updates the draft/published semester version | `48-semester.png` | Captured |
| Adviser | Semester | Reopen semester | Requires a reason and preserves the prior close history | `48-semester.png` | Captured visually; transaction tested separately |
| Data Management | Imports | Check Google connection | Shows the purpose-bound organization/plugin/import capability and access state | `49-imports.png` | Captured synthetic checking state; no live OAuth/Picker |
| Data Management | Imports | Preview normalized rows | Shows row target and ready/review/error state before commit | `49-imports.png` | Captured |
| Data Management | Imports | Commit valid rows | Remains blocked until exact source file, tab, and range exist | `49-imports.png` | Captured blocked state |
| Data Management | Imports | Start another import | Starts a fresh immutable source snapshot | `49-imports.png` | Captured |
| Authorized officer | Reports | Select semester | Scopes every count and export to one semester | `50-reports.png` | Captured |
| Authorized officer | Reports | Open records | Opens the filtered records that produced the metric | `50-reports.png` | Captured |
| Authorized officer | Reports | Download archive | Produces a permission-checked local ZIP with formula-safe CSV files and a manifest; no Google destination is used | `50-reports.png` | Service tested separately; visible download lifecycle pending |
| Admin/Adviser | Staff access | Assign position | Ensures host staff access without downgrading admins and records effective dates | `51-staff-access.png` | Captured visually; transaction tested separately |
| Admin/Adviser | Staff access | End assignment | Revokes the seat with immutable history | `51-staff-access.png` | Captured visually; transaction tested separately |
| Authorized officer | Change history | Review consequential events | Shows action, actor, target, details, and date | `52-change-history.png` | Captured |
| Admin/Data Management | Settings | Open Imports | Opens Google account, selected sources, and import history | `53-csf-settings.png` | Captured |
| Admin/Adviser | Settings | Open Semester | Opens schedule, policy, and term history | `53-csf-settings.png` | Captured |
| Member | My CSF | Review current status | Shows application, eligibility, dues, meetings, points, and decision | `54-member-my-csf.png` | Captured |
| Member | My CSF | Switch Activities / Point submissions | Opens the allowed member workspace | `54-member-my-csf.png` | Captured |
| Public visitor | Public page | Open website or Instagram | Opens the organization's existing public channel | `55-public-page.png` | Captured |
| Public visitor | Public page | Sign up for published activity | Opens only the activity's configured public signup | `55-public-page.png` | Captured |
| Any authenticated actor | Responsive Home | Use compact navigation and More menu | Keeps primary areas reachable at desktop, tablet, and phone widths | `56-home-*.png` | Captured in six variants |
