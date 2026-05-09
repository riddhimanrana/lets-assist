# DV Speech & Debate Plugin: Full Status Report & Bridge

This document serves as a comprehensive bridge for continuing the "DV Speech & Debate Ops" plugin development in a separate interface. It summarizes the original vision, current implementation state, identified deficiencies, and a detailed plan for full completion.

## 1. The Vision: DVSD Management System
The goal is to replace a fragmented system (Google Forms, individual emails, manual spreadsheets) with a unified native plugin inside Let's Assist.

### Core Pipeline
1.  **Student Enrollment**: A specialized signup link (`/signup?org=...&plugin=dv-speech-debate`) triggers a custom onboarding flow.
2.  **Integrated Profiles**: Automatic creation of Student and Parent profiles, linked together, stored in a dedicated `plugin_data` schema (isolated from the public platform schema).
3.  **Tournament Lifecycle**:
    - **Tabroom Sync**: Fetching tournament details directly via Tabroom IDs.
    - **Interest Tracking**: Custom forms within tournaments (e.g., Partner selection, Mentorship requirements).
    - **Judge Allocation**: AI-driven tool to pair parents with events based on clearance status and required ratios.
4.  **Operational Polish**:
    - **Google Sheets Sync**: Continuous, bi-directional sync with organization rosters.
    - **Bulk Communication**: Conditional emails via Resend (missing receipts, judge clearances).
    - **Storage**: Dedicated `plugin_form_uploads` bucket for secure receipt and ID uploads.

---

## 2. Current Implementation State

### ✅ Completed
- **Schema Isolation**: Multi-table schema deployed in `plugin_data` schema (students, parents, links, tournaments, activity logs).
- **Navigation Overrides**: Injected "DV Roster", "Judges", and "Tabroom Ops" tabs. Renamed platform "Projects" to **"Tournaments"**.
- **Storage Infrastructure**: `plugin_form_uploads` bucket created with appropriate RLS.
- **Signup Interception**: Custom plugin registration logic hooked into standard signup flow.
- **Enhanced UI**: Upgraded Roster and Judges tabs to professional **DataTable** views with searching and filtering.
- **Google Sheets Sync**: Backend and UI for syncing roster to a live spreadsheet implemented.

### 🕒 In-Progress / Skeletal
- **AI Logic**: `ai-features.ts` is initialized but empty (needs the judge pairing prompts).
- **Automation**: Bulk email triggers via Resend for missing items.

---

## 3. UI/UX Strategy (Implemented)

> [!IMPORTANT]
> **Repurposing "Projects"**
> We stopped hiding the core "Projects" tab. It is now renamed to **"Tournaments"**. This allows the plugin to use the native form builder and signup tracking for every tournament automatically.

> [!TIP]
> **DataTable Overhaul**
> The Roster and Judges views are no longer primitive lists. They use `@tanstack/react-table` for a premium, dense management experience suitable for 200+ members.

---

## 4. Remaining Features & Implementation Paths (Handover)

### A. AI Judge Allocation
- **Algorithm**: In `ai-features.ts`, build a prompt that takes entries and judges and outputs an optimized JSON pairing map.

### B. Bulk Communication (Resend)
- **Trigger**: Logic for "Remind all students with missing receipts" using the existing Resend integration.

---
*Report generated for session transition - 2026-04-12*
