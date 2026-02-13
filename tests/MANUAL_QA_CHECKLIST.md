# Waiver System Manual QA Checklist

**Date**: _____________
**Tester**: _____________
**Environment**: [x] Development [ ] Staging [ ] Production

---

## Phase 1: Database Schema ✅

- [ ] Migration applied successfully
- [ ] All tables created with correct columns (`waiver_definitions`, `waiver_definition_signers`, `waiver_definition_fields`)
- [ ] Constraints working (scope checks, unique keys)
- [ ] RLS policies active
- [ ] Existing waiver signatures still accessible (backward compatibility)

## Phase 2: PDF Field Detection 🔍

- [ ] Upload PDF with signature fields → fields detected automatically
- [ ] Upload PDF with text/checkbox fields → fields detected correctly
- [ ] Upload blank PDF → warning shown (no fields detected)
- [ ] Upload invalid file → error handled gracefully
- [ ] Field coordinates are accurate (visual overlay aligns)

## Phase 3: Waiver Builder Dialog (Organizer) 🛠️

### Project Creation
- [ ] Upload waiver PDF → Builder dialog opens automatically
- [ ] Detected signature fields are highlighted on PDF preview
- [ ] Can add signer roles (Student, Parent, Volunteer, etc.)
- [ ] Can map detected fields to signer roles
- [ ] Can add custom signature placements by clicking PDF
- [ ] Custom placements are draggable/resizable (desktop)
- [ ] Save button creates waiver definition in database
- [ ] Definition loads correctly when editing project later

### PDF Viewer
- [ ] PDF renders all pages correctly
- [ ] Page navigation works (prev/next buttons)
- [ ] Zoom controls work (zoom in, zoom out, fit to page)
- [ ] Detected fields show visual overlay (blue box)
- [ ] Custom placements show visual overlay (green box)

### Signer Roles Editor
- [ ] Can add new signer role
- [ ] Can edit role label (e.g., "Student", "Parent/Guardian")
- [ ] Can toggle required/optional
- [ ] Can reorder roles (drag-and-drop or buttons)
- [ ] Can delete role (if not in use)
- [ ] Cannot delete role if placements reference it (error shown)

### Mobile Testing
- [ ] Dialog opens full-screen on mobile
- [ ] Touch gestures work for pan/zoom
- [ ] All buttons are touch-friendly (minimum 44px tap target)
- [ ] Stepper navigation works

## Phase 4: Waiver Signing Dialog (Volunteer) ✍️

### Single Signer Flow
- [ ] Click "Sign Waiver" → Dialog opens
- [ ] PDF preview loads correctly
- [ ] Can review all pages
- [ ] "I have reviewed" checkbox works
- [ ] Draw signature method works (canvas)
- [ ] Type signature method works (text → image)
- [ ] Upload signature method works (file picker)
- [ ] Signature preview shows correctly
- [ ] Clear/redo button works
- [ ] Submit button disabled until signature complete

### Multi-Signer Flow (Student + Parent)
- [ ] Step 1: Review PDF works
- [ ] Step 2: Student signs (first signer)
- [ ] Step 3: Parent signs (second signer)
- [ ] Step 4: Review both signatures before submit
- [ ] Progress tracker shows completion status
- [ ] Cannot skip required signers
- [ ] Submit includes all signer data (role_key, method, data, timestamp)

### Integration
- [ ] Works in logged-in signup confirmation modal
- [ ] Works in anonymous signup form
- [ ] Form auto-fills user name/email
- [ ] Signature payload includes all signer data
- [ ] Legacy projects (no definition) still work with old system

### Mobile Testing
- [ ] Stepper navigation works smoothly
- [ ] Canvas signature works on touch devices
- [ ] File upload works on mobile
- [ ] Dialog is full-screen friendly
- [ ] Touch interactions responsive

## Phase 5: Server Validation & PDF Generation 🛡️

### Validation
- [ ] Signup with incomplete waiver → rejected with error
- [ ] Signup with all required signatures → accepted
- [ ] Invalid signature method → rejected
- [ ] Empty signature data → rejected
- [ ] Error messages are clear and helpful

### PDF Generation (On-Demand)
- [ ] Download waiver → PDF generated on-the-fly
- [ ] Drawn signatures stamped at correct positions
- [ ] Typed signatures rendered correctly
- [ ] Timestamps appear below signatures (small gray text)
- [ ] Multi-signer PDF includes all signatures
- [ ] Form fields are flattened (no edit ability)
- [ ] PDF opens correctly in viewer (no corruption)
- [ ] Uploaded signatures return uploaded file (not regenerated)

### Performance
- [ ] PDF generation completes within 3 seconds
- [ ] Loading indicator shown during generation
- [ ] Multiple concurrent downloads work
- [ ] No memory leaks during generation

## Phase 6: Global Template Management (Admin) 🌐

### Admin Access
- [ ] Only admins can access `/admin/waivers`
- [ ] Non-admins redirected appropriately
- [ ] Breadcrumb navigation works

### Template Management
- [ ] Can view list of global templates
- [ ] Active template clearly indicated (badge/highlight)
- [ ] Can create new template (upload PDF + configure)
- [ ] Waiver Builder reused for configuration
- [ ] Can activate a template
- [ ] Activating deactivates previous active template
- [ ] Only one template active at a time
- [ ] Can delete unused template
- [ ] Cannot delete template in use (error shown)
- [ ] Can edit template metadata (title, version)

### Fallback Integration
- [ ] Create project without custom waiver
- [ ] Signup uses active global template
- [ ] Change active global template
- [ ] Verify new signups use new template
- [ ] Old signups still reference old template

## Phase 7: Organizer View & Download 📥

### Manage Signups Interface
- [ ] Waiver status column appears
- [ ] "Signed" badge shows for completed waivers
- [ ] Badge shows signer count for multi-signer (e.g., "Signed (2 signers)")
- [ ] "Missing" badge shows for unsigned waivers
- [ ] "Not Required" shows when no waiver needed

### Preview Dialog
- [ ] Click "View Waiver" → Dialog opens
- [ ] Signer details displayed (name, role, method, timestamp)
- [ ] Multi-signer shows all signers in list
- [ ] PDF preview loads in iframe
- [ ] Can navigate PDF pages in preview

### Download
- [ ] Click "Download PDF" → File downloads
- [ ] Downloaded PDF opens correctly
- [ ] Signatures visible at correct positions
- [ ] Filename includes signature ID (e.g., `waiver-sig-123.pdf`)
- [ ] Multiple downloads work (no rate limiting issues)

### Authorization
- [ ] Only project organizer can view waivers
- [ ] Non-organizer cannot access download endpoint
- [ ] Admin can view all project waivers

### Mobile Testing
- [ ] Dropdown menu works on mobile
- [ ] Preview dialog responsive
- [ ] Download works on mobile devices

## Cross-Cutting Concerns ⚙️

### Error Handling
- [ ] Network errors handled gracefully
- [ ] Invalid PDF errors shown clearly
- [ ] Database errors logged appropriately (OpenTelemetry)
- [ ] User-friendly error messages (no technical jargon)

### Performance
- [ ] No console errors in browser
- [ ] No memory leaks during PDF operations
- [ ] Large PDFs (10+ pages) load reasonably
- [ ] Multiple users can sign concurrently

### Data Integrity
- [ ] Signature payload structure correct in database (JSONB)
- [ ] Timestamps accurate (ISO 8601 format)
- [ ] IP addresses captured (if enabled)
- [ ] User agents captured

### Backward Compatibility
- [ ] Legacy projects (old schema) still work
- [ ] Old waiver signatures still viewable
- [ ] No breaking changes to existing signups
- [ ] Migration path documented

## Browser/Device Testing 🌐

- [ ] Chrome (Desktop)
- [ ] Firefox (Desktop)
- [ ] Safari (Desktop)
- [ ] Chrome (Android)
- [ ] Safari (iOS)
- [ ] Edge (Desktop)

---

## Test Results Summary

**Total Tests**: ___ / ___
**Passed**: ___ / ___
**Failed**: ___ / ___
**Blocked**: ___ / ___

**Critical Issues Found**:
1. _____________________________________________
2. _____________________________________________

**Minor Issues Found**:
1. _____________________________________________
2. _____________________________________________

**Notes**:
________________________________________________________________
________________________________________________________________
________________________________________________________________

---

## Sign-Off

- [ ] All critical functionality tested
- [ ] No blocking issues
- [ ] Ready for production

**QA Engineer**: __________________ **Date**: __________
**Developer**: ____________________ **Date**: __________
