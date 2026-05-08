# DV Speech & Debate (DVSD) Management System

This document serves as the primary technical specification and progress report for the DVSD plugin, consolidating all requirements from the initial prompt and tracking current implementation status.

## 1. Project Vision & Core Flow
The goal is to provide a seamless, end-to-end management experience for the DV Speech & Debate organization, scaling to 200+ students and their accompanying parent judges.

### The Targeted Workflow
1.  **Onboarding**: Students/Parents visit a specialized signup link (e.g., `/signup?org=dvsd&plugin=dv-speech-debate`).
2.  **Registration**: New users fill out the comprehensive 2025-2026 membership form.
3.  **Data Graph**: The system automatically links students to their parents and initializes their profiles in the `plugin_data` schema.
4.  **Verification**: Staff use the "DV Roster" to verify dues (uploaded receipts) and "Judges" tab to verify parent clearances.
5.  **Tournaments**: Standard tournaments (native Projects) are created. Tabroom data is synced via "Tabroom Ops" to populate entries.
6.  **Assignments**: AI Allocation tool pairs parent judges with tournament events based on clearance and availability.
7.  **Synchronization**: The entire roster is lived-synced to Google Sheets for administrative reporting.

---

## 2. Requirements Checklist & Status

| Feature | Requirement | Status |
| :--- | :--- | :--- |
| **Signup Flow** | Specialized plugin-aware onboarding | ✅ Implemented |
| **Data Schema** | Isolated `plugin_data` schema for security | ✅ Implemented |
| **Navigation** | Overridden sidebar with custom DVSD tabs | ✅ Implemented |
| **Roster UI** | High-density DataTable for 200+ students | ✅ Implemented |
| **Judges UI** | Dedicated view for parent judge tracking | ✅ Implemented |
| **Tabroom Sync** | Fetching tournament data via GraphQL | ✅ Implemented |
| **Sheets Sync** | Auto-pushing roster data to Google Sheets | ✅ Implemented |
| **Storage** | Secure bucket for receipts and IDs | ✅ Implemented |
| **AI Allocation** | Automated judge assignment algorithm | 🕒 Skeleton Ready |
| **Communication** | Bulk Resend emails for follow-ups | 🕒 Pending |

---

## 3. Implementation Details

### UI Improvements
- **Repurposed Projects**: The native "Projects" tab is now renamed to **"Tournaments"** in the sidebar. This allows us to use all core platform features (Forms, Signups) for tournaments without extra code.
- **Premium Icons**: Distinct icons for Roster (Users), Judges (Gavel), and Tournaments (Trophy).
- **DataTables**: Professional grid views using `@tanstack/react-table` with multi-column filtering.

### Google Sheets Integration
- **Service**: Integrated with `services/google-sheets.ts`.
- **UI**: Configuration panel in the Roster tab to set `Spreadsheet ID` and `Tab Name`.

### Storage Infrastructure
- **Bucket**: `plugin_form_uploads`
- **Use Case**: Secure handling of membership dues receipts and parent ID scans.

---

## 4. Immediate Roadmap (For next Assistant)

### Phase 1: AI Judge Allocation
- Implement the pairing algorithm in `lib/plugins/private/plugins/dv-speech-debate/ai-features.ts`.
- Use the Gemini/Anthropic models to handle complex parent-student conflict resolution.

### Phase 2: Bulk Communication
- Trigger "Reminder Emails" via Resend for students with `paid_membership = false`.
- Trigger "Clearance Alerts" for judges with `onboarding_complete = false`.

### Phase 3: Tournament Detail Fusion
- Finalize the auto-population of native platform Project Forms from Tabroom sync data.

---
*Created on 2026-04-12 for transition to Gemini CLI.*
