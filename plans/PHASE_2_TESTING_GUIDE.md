# Phase 2 Testing Guide - PDF.js Widget Detection

## Implementation Summary

Phase 2 successfully replaced naive string-based PDF signature detection with robust PDF.js-based widget extraction in the waiver upload flows.

### What Was Changed

**Created Files:**
1. `lib/waiver/pdf-field-detect.ts` - Core PDF.js detection utility
2. `hooks/use-pdf-field-detection.ts` - React hook wrapper

**Modified Files:**
1. `app/projects/create/VerificationSettings.tsx` - Updated `validatePdfFile()` function
2. `app/projects/[id]/edit/EditProjectClient.tsx` - Updated `validateWaiverPdf()` function

### Key Features

- ✅ PDF.js-based annotation extraction from PDF widgets
- ✅ Accurate field type detection (signature, text, checkbox, radio, dropdown, button)
- ✅ Field coordinates extraction (x, y, width, height) for future overlay UI
- ✅ Page number tracking (0-indexed)
- ✅ Required field detection via fieldFlags
- ✅ Default value extraction
- ✅ Graceful fallback to naive detection if PDF.js fails
- ✅ Detailed detection results with warnings
- ✅ Support for both File objects (browser) and URLs

## Manual Testing Checklist

Since this is primarily a client-side browser feature, automated testing is limited. Follow this manual testing checklist:

### Test Case 1: PDF with Signature Fields
**Objective:** Verify detection of signature fields in AcroForm PDFs

**Steps:**
1. Navigate to `/projects/create`
2. Enable "Require waiver signature" toggle
3. Upload a PDF with AcroForm signature fields (e.g., a waiver from DocuSign, HelloSign, etc.)
4. Wait for validation to complete

**Expected Results:**
- Loading spinner should appear briefly
- Green success alert: "Signature fields detected. Volunteers can sign directly on the PDF."
- Warning message should show: "Detected X signature field(s) and Y other form field(s) across Z page(s)."

### Test Case 2: PDF with Text/Checkbox Fields
**Objective:** Verify detection of non-signature form fields

**Steps:**
1. Navigate to `/projects/create`
2. Enable "Require waiver signature"
3. Upload a PDF with text fields and checkboxes but NO signature fields

**Expected Results:**
- Amber warning alert appears
- Message: "No signature fields detected. Volunteers will sign electronically (draw/type) alongside this document."
- Should still show field count if detection succeeded

### Test Case 3: Blank PDF (No Fields)
**Objective:** Verify behavior with PDFs that have no form fields

**Steps:**
1. Navigate to `/projects/create`
2. Upload a simple PDF with just text/images but no form fields (e.g., a scanned document)

**Expected Results:**
- Amber warning alert
- Message: "No signature fields detected. Volunteers will sign electronically (draw/type) alongside this document."
- Detection should succeed with 0 fields

### Test Case 4: Invalid/Corrupted PDF
**Objective:** Verify error handling for invalid files

**Steps:**
1. Try to upload a non-PDF file renamed to .pdf
2. Try to upload a corrupted PDF

**Expected Results:**
- Error message appears
- Fallback detection should attempt to run
- User receives clear error feedback

### Test Case 5: Large PDF File
**Objective:** Test performance with multi-page PDFs

**Steps:**
1. Upload a large PDF (100+ pages) with multiple form fields

**Expected Results:**
- Loading indicator should show while processing
- Detection should complete successfully (may take a few seconds)
- Should report accurate page count and field count

### Test Case 6: Project Edit Flow
**Objective:** Verify detection works in project edit flow

**Steps:**
1. Go to an existing project
2. Navigate to edit page `/projects/[id]/edit`
3. Enable "Require waiver signature" if not already enabled
4. Upload a PDF with signature fields

**Expected Results:**
- Same detection behavior as create flow
- Validation results displayed correctly
- Can preview, download, and remove PDF

## Integration Testing

### Create Project Flow
1. Create a new project with waiver required
2. Upload PDF → verify detection
3. Complete project creation
4. Verify PDF is saved and detection result stored

### Edit Project Flow
1. Edit an existing project
2. Upload/replace waiver PDF → verify detection
3. Save changes
4. Verify new PDF and detection results persist

### Volunteer Signup Flow
*Note: This will be tested in Phase 3 when builder UI is implemented*

## Known Limitations & Edge Cases

1. **PDF.js Worker Setup**
   - Uses CDN worker: `cdnjs.cloudflare.com/ajax/libs/pdf.js/[version]/pdf.worker.min.mjs`
   - May have CORS issues in some environments
   - Fallback detection handles this gracefully

2. **Coordinate Systems**
   - PDF coordinates use bottom-left origin
   - Y-axis may need flipping for overlay rendering in Phase 3
   - Coordinates are in PDF points (1/72 inch)

3. **Field Type Mapping**
   - PDF "Btn" type can be checkbox, radio, or push button
   - Currently defaults to checkbox
   - May need refinement based on buttonFlags in Phase 3

4. **TypeScript Type Definitions**
   - pdfjs-dist has known issues with private identifiers
   - Causes tsc errors but compiles fine in Next.js
   - Does not affect runtime functionality

## Troubleshooting

### "Could not fully analyze PDF structure" Warning

**Possible Causes:**
- PDF.js failed to parse the PDF
- Unsupported PDF version
- Encrypted/password-protected PDF
- Network issue loading PDF.js worker

**Resolution:**
- Fallback detection will still attempt basic string matching
- User can still proceed with e-signature option
- Check browser console for detailed error messages

### No Fields Detected on a PDF with Fields

**Possible Causes:**
- PDF uses flatten fields (non-interactive)
- Fields are image-based, not AcroForm
- PDF was scanned without OCR/form recognition

**Resolution:**
- This is expected behavior - PDF truly has no interactive fields
- Volunteers will use draw/type signature method

## Next Steps (Phase 3)

Phase 2 provides the foundation for Phase 3: Builder Dialog UI

The detected field information (field type, coordinates, page number) will be used to:
- Display field overlay in builder dialog
- Allow organizers to map detected fields to volunteer data
- Position signature/text overlays accurately
- Validate field requirements before signup completion

## Success Criteria

- [x] PDF.js detection utility created
- [x] React hook wrapper created
- [x] Project creation flow updated
- [x] Project edit flow updated
- [x] Graceful fallback implemented
- [x] Detection results displayed in UI
- [ ] Manual testing completed (all 6 test cases)
- [ ] Integration testing completed

## Manual Testing Status

**Tester:** _____________
**Date:** _____________

| Test Case | Status | Notes |
|-----------|--------|-------|
| TC1: PDF with Signature Fields | ⬜ Pass / ⬜ Fail | |
| TC2: PDF with Text/Checkbox | ⬜ Pass / ⬜ Fail | |
| TC3: Blank PDF | ⬜ Pass / ⬜ Fail | |
| TC4: Invalid PDF | ⬜ Pass / ⬜ Fail | |
| TC5: Large PDF | ⬜ Pass / ⬜ Fail | |
| TC6: Edit Flow | ⬜ Pass / ⬜ Fail | |

## Verification Commands

```bash
# Check files were created
ls -lh lib/waiver/pdf-field-detect.ts
ls -lh hooks/use-pdf-field-detection.ts

# Verify pdfjs-dist was installed
grep "pdfjs-dist" package.json

# Check imports in modified files
grep "detectPdfWidgets" app/projects/create/VerificationSettings.tsx
grep "detectPdfWidgets" app/projects/[id]/edit/EditProjectClient.tsx
```
