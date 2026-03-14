# OWASP Script Injection Remediation

Date: 2026-03-06

## Summary

This remediation closes the OWASP-style script-injection and stored-XSS risks
identified during the browser-assisted security review.

The fixes focus on three layers:

1. **Render-time protection** for rich-text HTML shown on public pages.
2. **Write-time sanitization** so malicious rich-text payloads are not stored
   in projects or drafts.
3. **Escape-on-print/export** protection for HTML strings that are injected
   into `innerHTML` or written into an iframe document for printing.

## Vulnerabilities fixed

### 1. Stored XSS via project descriptions on public project pages

### Risk: public stored rich-text HTML

- `components/ui/rich-text-content.tsx` rendered stored project HTML with
  `dangerouslySetInnerHTML`.
- `app/projects/create/BasicInfo.tsx` and
  `components/ui/rich-text-editor.tsx` allowed HTML authoring, but the saved
  content was not sanitized before persistence.
- Existing stored records could therefore be rendered back to any public
  visitor.

### Fix: sanitize public rich-text rendering and persistence

- Added shared rich-text sanitization policies in:
  - `lib/security/html.ts`
  - `lib/security/html.client.ts`
  - `lib/security/html.server.ts`
- Updated `components/ui/rich-text-content.tsx` to sanitize HTML before
  rendering.
- Updated `components/ui/rich-text-editor.tsx` to sanitize editor content on
  input/output and reject unsafe link protocols.
- Updated project create/update paths to sanitize descriptions before saving.

### 2. Unsafe rich-text link handling

### Risk: unsafe rich-text link protocols

- The editor link dialog previously accepted arbitrary URL strings.
- This created a path for dangerous protocols such as `javascript:` or `data:`
  to be stored in project descriptions.

### Fix: enforce safe link normalization

- Added `normalizeRichTextLinkUrl(...)` in `lib/security/html.ts`.
- Restricted rich-text links to:
  - `https:`
  - `http:`
  - `mailto:`
  - `tel:`
  - relative paths, fragments, and query-only links
- Rejected dangerous protocols at authoring time.

### 3. Stored XSS in printable/export HTML sinks

### Risk: printable HTML string injection

The following files built printable HTML strings with unescaped
user-controlled fields and injected them into the DOM:

- `app/certificates/[id]/_components/PrintCertificate.tsx`
- `app/certificates/CertificatesList.tsx`
- `app/projects/[id]/signups/SignupsClient.tsx`
- `app/projects/[id]/attendance/AttendanceClient.tsx`

Affected data included project titles, volunteer names, organization names,
comments, contact details, and locations.

### Fix: escape user-controlled printable fields

- Added safe HTML escaping helpers:
  - `escapeHtml(...)`
  - `escapeHtmlWithLineBreaks(...)`
- Escaped all user-controlled printable fields before interpolating them into
  HTML strings.
- Preserved multiline volunteer comments safely by converting newlines to
  `<br />` after HTML escaping.

### 4. Defense in depth for project draft persistence and project updates

### Risk: unsanitized draft and update persistence

- Draft autosave/new draft persistence and published project updates could
  store unsanitized rich-text HTML.

### Fix: sanitize description data before storing updates and drafts

- Sanitized rich-text descriptions when saving:
  - draft data
  - newly created projects
  - edited projects
  - updated draft projects

## Files changed

### New security utilities

- `lib/security/html.ts`
  - shared allowlists, URI policy, escaping helpers, and safe link
    normalization
- `lib/security/html.client.ts`
  - client-side rich-text sanitizer using the shared allowlist policy
- `lib/security/html.server.ts`
  - server-side `sanitize-html` wrapper for persistence protection

### Hardened rich-text surfaces

- `components/ui/rich-text-content.tsx`
- `components/ui/rich-text-editor.tsx`
- `app/projects/create/actions.ts`
- `app/projects/[id]/actions.ts`

### Hardened print/export HTML sinks

- `app/certificates/[id]/_components/PrintCertificate.tsx`
- `app/certificates/CertificatesList.tsx`
- `app/projects/[id]/signups/SignupsClient.tsx`
- `app/projects/[id]/attendance/AttendanceClient.tsx`

### Tests added

- `lib/security/html.test.ts`
- `components/ui/rich-text-content.test.tsx`

### Sanitizer implementation

- Standardized both write-time and render-time rich-text sanitization on the
  shared `sanitize-html` allowlist policy.

## Security policy details

### Allowed rich-text tags

- `p`, `br`
- `strong`, `em`, `u`, `s`
- `ul`, `ol`, `li`
- `blockquote`, `code`, `pre`
- `a`
- `h1` through `h6`

### Allowed link schemes

- `https`
- `http`
- `mailto`
- `tel`
- relative links and fragments

### Explicitly blocked behavior

- inline event handlers such as `onerror`, `onclick`, and `onload`
- `<script>` and `<style>` tags in rich text
- unsafe URL schemes such as `javascript:` and `data:`
- HTML interpretation of printable user-controlled fields

## Verification performed

The implementation is designed to address the findings discovered during the
OWASP testing pass:

- public rich-text project descriptions are sanitized before render
- project descriptions are sanitized before write/update persistence
- print/export HTML sinks escape user-controlled values before `innerHTML` /
  `document.write`
- editor link submission rejects dangerous protocols

Recommended local verification after merge:

1. Visit a public project page with rich text content and confirm safe
   formatting still renders.
2. Create or edit a project description using links and lists.
3. Confirm printable views still work for:
   - volunteer signups
   - attendance lists
   - certificates
4. Attempt to save a link using `javascript:alert(1)` in the editor and
   confirm it is rejected.

## Surfaces reviewed but not changed

- `components/ui/chart.tsx`
  - reviewed during the audit; current usage is configuration-driven rather
    than user-content-driven
- query-string driven toast and auth error messaging flows
  - reviewed and live-tested as text rendering rather than HTML injection

## Outcome

This remediation removes the confirmed public stored-HTML XSS path, closes the
identified organizer-side printable HTML injection paths, and adds write-time
and render-time defense in depth for rich text.
