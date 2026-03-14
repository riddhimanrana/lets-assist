## Plan: AI Waiver Field Positioning Accuracy Overhaul

Transform the AI waiver analysis from vision-only "measurement guessing" to structural data + AI reasoning, dramatically improving bounding box accuracy from ~70% to 95%+ by providing text coordinates, label positions, and candidate boxes for AI classification instead of coordinate generation.

**Phases**: 6 phases

1. **Phase 1: PDF Text Extraction Infrastructure**
    - **Objective:** Extract text content with precise bounding boxes from PDFs using PDF.js, providing the foundational structural data needed for accurate field detection.
    - **Files/Functions to Modify/Create:**
        - Create [lib/waiver/pdf-text-extract.ts](lib/waiver/pdf-text-extract.ts) - New utility for PDF.js text extraction
        - Modify [app/api/ai/analyze-waiver/route.ts](app/api/ai/analyze-waiver/route.ts) - Integrate text extraction into AI pipeline
    - **Tests to Write:**
        - `extractPdfTextWithPositions returns text items with coordinates`
        - `extractPdfTextWithPositions handles multi-page PDFs`
        - `extractPdfTextWithPositions handles rotated pages`
        - `extractPdfTextWithPositions handles empty pages`
        - `text item bounding boxes are in PDF coordinate space`
    - **Steps:**
        1. Write tests for PDF text extraction (expect failures)
        2. Create `lib/waiver/pdf-text-extract.ts` with `extractPdfTextWithPositions(pdfData: Uint8Array)` function
        3. Use `pdfjs-dist` to load PDF and extract text content per page via `page.getTextContent()`
        4. Transform text items into normalized format: `{text, x, y, width, height, pageIndex}`
        5. Handle viewport transforms (rotation, viewBox) correctly
        6. Run tests to verify extraction accuracy

2. **Phase 2: Label and Candidate Detection**
    - **Objective:** Identify signature-related labels ("Signature:", "Date:", "Name:") and automatically detect candidate writable areas (underscores, boxes, lines) near labels with precise coordinates.
    - **Files/Functions to Modify/Create:**
        - Create [lib/waiver/label-detection.ts](lib/waiver/label-detection.ts) - Label and keyword detection
        - Create [lib/waiver/candidate-detection.ts](lib/waiver/candidate-detection.ts) - Heuristic writable area detection
        - Modify [app/api/ai/analyze-waiver/route.ts](app/api/ai/analyze-waiver/route.ts) - Integrate candidate detection
    - **Tests to Write:**
        - `findLabels detects signature keywords with various formats`
        - `findLabels handles case-insensitive matching`
        - `detectCandidateAreas finds underscores after labels`
        - `detectCandidateAreas finds boxes near labels`
        - `detectCandidateAreas returns coordinate ranges`
        - `detectCandidateAreas handles multi-column layouts`
    - **Steps:**
        1. Write tests for label detection (expect failures)
        2. Create `findLabels(textItems)` function to identify "Signature", "Date", "Name", "Print", "Guardian" keywords
        3. Write tests for candidate area detection (expect failures)
        4. Create `detectCandidateAreas(textItems, labels)` to find writable spaces:
           - Detect underscore sequences (`_____`)
           - Detect horizontal whitespace gaps after labels
           - Estimate reasonable field dimensions based on surrounding text
        5. Return candidates as `{id, rect: {x,y,width,height}, nearbyLabels: string[], typeHint: string, pageIndex}`
        6. Run tests to verify candidate detection

3. **Phase 3: Enhanced AI Schema with Structural Input**
    - **Objective:** Update the AI prompt and schema to receive structured data (text positions, labels, candidates, widgets) and return field classifications instead of coordinate measurements, shifting AI from "measuring" to "reasoning".
    - **Files/Functions to Modify/Create:**
        - Modify [app/api/ai/analyze-waiver/route.ts](app/api/ai/analyze-waiver/route.ts) - Update schema and prompt
        - Create `WaiverStructuralDataSchema` for input data
        - Create `WaiverFieldClassificationSchema` for AI output
    - **Tests to Write:**
        - `AI receives text items in structured format`
        - `AI receives candidate areas with IDs`
        - `AI receives widget information when available`
        - `AI returns candidate ID selections instead of coordinates`
        - `AI classifies field types correctly`
        - `AI assigns signer roles correctly`
    - **Steps:**
        1. Write tests for schema validation (expect failures)
        2. Create `WaiverStructuralDataSchema` Zod schema containing:
           - `pages: [{width, height, rotation, viewBox}]`
           - `textItems: [{text, bbox, pageIndex}]`
           - `labels: [{text, type, bbox, pageIndex}]`
           - `candidates: [{id, rect, typeHint, nearbyLabels, pageIndex}]`
           - `widgets: [{name, type, rect, pageIndex}]` (from AcroForm)
        3. Update AI prompt to:
           - Explain structured data format
           - Ask AI to SELECT candidate IDs
           - Ask AI to CLASSIFY field types
           - Remove measurement instructions
           - Add reasoning instructions
        4. Create `WaiverFieldClassificationSchema` for AI response:
           - `selectedFields: [{candidateId, fieldType, signerRole, label, required}]`
           - `signerRoles: [{key, label, required}]`
           - `reasoning: string` (why AI made these choices)
        5. Run tests to verify schema structure

4. **Phase 4: Coordinate System Standardization**
    - **Objective:** Eliminate coordinate system ambiguity by enforcing PDF coordinate space (bottom-left origin) throughout the pipeline and removing Y-axis flip guessing logic.
    - **Files/Functions to Modify/Create:**
        - Modify [app/api/ai/analyze-waiver/route.ts](app/api/ai/analyze-waiver/route.ts) - Remove flip inference, enforce standard
        - Modify [lib/waiver/pdf-text-extract.ts](lib/waiver/pdf-text-extract.ts) - Ensure PDF.js coords correctly transformed
        - Modify [lib/waiver/generate-signed-waiver-pdf.ts](lib/waiver/generate-signed-waiver-pdf.ts) - Verify Y-flip necessity
    - **Tests to Write:**
        - `all coordinates use PDF coordinate space (bottom-left origin)`
        - `Y-axis direction is consistent across pipeline`
        - `no coordinate flipping occurs`
        - `overlay rendering matches stored coordinates`
        - `PDF stamping matches overlay positions`
    - **Steps:**
        1. Write tests for coordinate system consistency (expect failures)
        2. Remove `inferYAxisFlipByPage()` function (no longer needed)
        3. Remove `coordinateSystem` optional field from schema (enforce single standard)
        4. Update `normalizeFieldsForOverlay()` to assume PDF coordinate space
        5. Verify PDF.js text extraction returns bottom-left origin coords
        6. Review `generate-signed-waiver-pdf.ts` Y-flip logic - document or fix coordinate convention
        7. Add documentation comment explaining coordinate system contract
        8. Run tests to verify consistency

5. **Phase 5: Integration and Pipeline Transformation**
    - **Objective:** Wire together text extraction, candidate detection, and AI classification into a cohesive pipeline that prioritizes AcroForm widgets, then uses structural data + AI reasoning for remaining fields.
    - **Files/Functions to Modify/Create:**
        - Modify [app/api/ai/analyze-waiver/route.ts](app/api/ai/analyze-waiver/route.ts) - Complete pipeline integration
        - Modify [components/waiver/WaiverBuilderDialog.tsx](components/waiver/WaiverBuilderDialog.tsx) - Handle new response format
    - **Tests to Write:**
        - `pipeline prioritizes AcroForm widgets first`
        - `pipeline extracts text with coordinates`
        - `pipeline detects labels and candidates`
        - `pipeline sends structured data to AI`
        - `pipeline maps AI classifications to coordinates`
        - `pipeline handles PDFs with no text (scanned images)`
        - `pipeline handles PDFs with widgets`
        - `pipeline handles multi-page PDFs`
        - `pipeline returns backward-compatible format`
    - **Steps:**
        1. Write integration tests (expect failures)
        2. Update POST handler in [app/api/ai/analyze-waiver/route.ts](app/api/ai/analyze-waiver/route.ts):
           - Step 1: Extract AcroForm widgets using existing `detectPdfWidgets()`
           - Step 2: Extract text with coordinates using `extractPdfTextWithPositions()`
           - Step 3: Detect labels using `findLabels()`
           - Step 4: Detect candidate areas using `detectCandidateAreas()`
           - Step 5: Build structured input data
           - Step 6: Send to AI for classification
           - Step 7: Map AI selections back to coordinates
           - Step 8: Merge widgets + AI-classified fields
           - Step 9: Return in backward-compatible format
        3. Handle edge case: scanned PDFs with no extractable text (fallback to vision-only with warning)
        4. Update [components/waiver/WaiverBuilderDialog.tsx](components/waiver/WaiverBuilderDialog.tsx) to handle potential new response fields
        5. Run integration tests to verify complete pipeline

6. **Phase 6: Validation, Accuracy Testing, and Documentation**
    - **Objective:** Validate the new pipeline with real-world waiver PDFs, measure accuracy improvement, add comprehensive error handling, and document the new architecture.
    - **Files/Functions to Modify/Create:**
        - Create [tests/fixtures/sample-waivers/](tests/fixtures/sample-waivers/) - Test waiver PDFs
        - Create [tests/integration/ai-positioning-accuracy.test.ts](tests/integration/ai-positioning-accuracy.test.ts) - Accuracy validation suite
        - Update [app/api/ai/analyze-waiver/route.ts](app/api/ai/analyze-waiver/route.ts) - Add error handling and logging
        - Create [docs/AI_POSITIONING.md](docs/AI_POSITIONING.md) - Architecture documentation
    - **Tests to Write:**
        - `accuracy test: simple single-signer waiver (95%+ accuracy)`
        - `accuracy test: multi-signer parent/guardian waiver (90%+ accuracy)`
        - `accuracy test: complex multi-page waiver (85%+ accuracy)`
        - `accuracy test: fillable PDF with AcroForm (100% accuracy)`
        - `accuracy test: scanned PDF (graceful degradation)`
        - `error handling: corrupted PDF`
        - `error handling: oversized PDF`
        - `error handling: AI timeout`
        - `error handling: no extractable text`
    - **Steps:**
        1. Collect 5-10 diverse sample waiver PDFs (various formats, complexities)
        2. Write accuracy validation tests using sample PDFs
        3. Run tests and measure baseline accuracy with new pipeline
        4. Add comprehensive error handling:
           - Timeout guards for AI calls
           - Fallback for extraction failures
           - Detailed error messages for debugging
        5. Add structured logging for AI reasoning and coordinate transformations
        6. Create [docs/AI_POSITIONING.md](docs/AI_POSITIONING.md) documenting:
           - Architecture overview
           - Coordinate system contract
           - Pipeline flow diagram
           - Error handling strategies
           - Accuracy benchmarks
        7. Run full test suite to verify no regressions

**Open Questions**

1. **Should we support scanned/image-only PDFs with vision-only fallback?** Option A: Yes, fallback to current vision-only approach with warning / Option B: Require text-extractable PDFs only / Option C: Auto-OCR scanned PDFs before processing (adds complexity and cost)

2. **How to handle ambiguous candidate areas?** Option A: Return all candidates and let AI choose / Option B: Use stricter heuristics to filter candidates / Option C: Let AI propose additional candidates if none fit

3. **Should coordinate system be top-left or bottom-left throughout?** Option A: Bottom-left (PDF standard, current overlay system) / Option B: Top-left (more intuitive, but requires changing overlay rendering) / Option C: Support both with explicit conversion layer

4. **AI model choice for reasoning tasks?** Option A: Keep Gemini 2.5 Flash Lite (fast, cheap) / Option B: Upgrade to Gemini 2.5 Flash (more capable reasoning) / Option C: Use GPT-4o (possibly better at structured reasoning)

5. **Backward compatibility strategy?** Option A: Maintain exact same API response format (recommended) / Option B: Add new API endpoint for enhanced version / Option C: Version API (v2) with migration path
