import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * Phase 5 E2E Validation: Waiver AI Detection
 * 
 * This test validates the end-to-end flow of:
 * 1. Uploading a PDF waiver
 * 2. Opening the waiver builder dialog
 * 3. Triggering AI scan
 * 4. Verifying detection results
 * 
 * Requirements:
 * - ENABLE_E2E_AUTH_BYPASS=true must be set in .env.local
 * - Dev server must be running (bun run dev)
 * - "Volunteer Waiver 2025.pdf" must exist at project root
 */

const PDF_PATH = path.resolve(process.cwd(), 'Volunteer Waiver 2025.pdf');
const TEST_HARNESS_URL = '/test-harness/waiver-builder';

async function uploadPdfUntilReady(page: import('@playwright/test').Page) {
  const fileInput = page.getByTestId('pdf-upload-input');
  const openBuilderButton = page.getByTestId('open-builder-button');

  for (let attempt = 0; attempt < 3; attempt++) {
    await fileInput.setInputFiles([]);
    await fileInput.setInputFiles(PDF_PATH);

    try {
      await expect(openBuilderButton).toBeEnabled({ timeout: 10000 });
      return;
    } catch {
      // Retry upload if harness state did not update on this attempt.
    }
  }

  await expect(openBuilderButton).toBeEnabled({ timeout: 10000 });
}

type AnalyzeWaiverResponse = {
  analysis?: {
    pageCount: number;
    signerRoles: Array<{ roleKey: string; label: string; required: boolean }>;
    fields: Array<{
      fieldType: string;
      signerRole: string;
      pageIndex: number;
      boundingBox: { x: number; y: number; width: number; height: number };
      required: boolean;
      label: string;
    }>;
  };
  error?: string;
  details?: string;
};

test.describe('Waiver AI Detection E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Enable console logging for debugging
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('Browser console error:', msg.text());
      }
    });

    // Navigate to test harness
    await page.goto(TEST_HARNESS_URL);
    await expect(page.getByTestId('waiver-test-harness')).toBeVisible();
  });

  test('should upload PDF, trigger AI scan, and detect fields', async ({ page }) => {
    // Step 1: Upload PDF
    await uploadPdfUntilReady(page);

    // Step 2: Open waiver builder dialog
    const openButton = page.getByTestId('open-builder-button');
    await openButton.click();

    // Verify dialog is open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Configure Waiver')).toBeVisible();

    // Move to fields tab so detection summary metrics are visible
    await page.getByRole('tab', { name: /2\. Fields & Signatures/i }).click();

    const signerCountNode = page.getByTestId('waiver-summary-signer-roles');
    const customPlacementNode = page.getByTestId('waiver-summary-custom-placements');

    await expect(signerCountNode).toBeVisible();
    await expect(customPlacementNode).toBeVisible();

    const initialSignerCount = Number.parseInt((await signerCountNode.innerText()).trim(), 10) || 0;
    const initialCustomCount = Number.parseInt((await customPlacementNode.innerText()).trim(), 10) || 0;

    // Step 3: Trigger AI scan and capture the API response
    const analyzeResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/ai/analyze-waiver') && resp.request().method() === 'POST',
      { timeout: 120000 }
    );

    const aiScanButton = page.getByTestId('waiver-ai-scan-button');
    await expect(aiScanButton).toBeVisible();
    await aiScanButton.click();

    const analyzeResponse = await analyzeResponsePromise;
    const responseStatus = analyzeResponse.status();
    const payload = (await analyzeResponse.json()) as AnalyzeWaiverResponse;

    expect(responseStatus, `AI analyze route failed: ${JSON.stringify(payload)}`).toBe(200);
    expect(payload.analysis).toBeDefined();
    expect(Array.isArray(payload.analysis?.signerRoles)).toBe(true);
    expect(Array.isArray(payload.analysis?.fields)).toBe(true);

    const apiRoles = payload.analysis?.signerRoles ?? [];
    const apiFields = payload.analysis?.fields ?? [];

    // API-level quality checks for this complex waiver
    expect(apiRoles.length).toBeGreaterThanOrEqual(2);
    expect(apiFields.length).toBeGreaterThan(0);
    expect(apiFields.some((f) => f.fieldType === 'signature')).toBe(true);

    const hasParentOrGuardianRole = apiRoles.some((r) => /parent|guardian/i.test(r.roleKey) || /parent|guardian/i.test(r.label));
    expect(hasParentOrGuardianRole).toBe(true);

    // Ensure API returns finite, positive bounding boxes
    for (const field of apiFields) {
      expect(Number.isFinite(field.boundingBox.x)).toBe(true);
      expect(Number.isFinite(field.boundingBox.y)).toBe(true);
      expect(Number.isFinite(field.boundingBox.width)).toBe(true);
      expect(Number.isFinite(field.boundingBox.height)).toBe(true);
      expect(field.boundingBox.width).toBeGreaterThan(0);
      expect(field.boundingBox.height).toBeGreaterThan(0);
      expect(field.pageIndex).toBeGreaterThanOrEqual(0);
    }

    // Step 4: Wait for scan to finish and summary metrics to update
    await expect
      .poll(async () => {
        const signerRaw = (await signerCountNode.innerText()).trim();
        const customRaw = (await customPlacementNode.innerText()).trim();
        const signerCount = Number.parseInt(signerRaw, 10) || 0;
        const customCount = Number.parseInt(customRaw, 10) || 0;
        return signerCount > initialSignerCount || customCount > initialCustomCount;
      }, {
        timeout: 120000,
        message: 'AI scan did not populate signer roles/custom placements in time',
      })
      .toBe(true);

    const signerCount = Number.parseInt((await signerCountNode.innerText()).trim(), 10) || 0;
    const customCount = Number.parseInt((await customPlacementNode.innerText()).trim(), 10) || 0;

    console.log('✅ E2E Test Results:', {
      detectedSignerRoles: signerCount,
      detectedCustomPlacements: customCount,
    });

    // Assertions based on known PDF structure
    // Ensure scan actually changed something from initial summary
    expect(signerCount > initialSignerCount || customCount > initialCustomCount).toBe(true);

    // "Volunteer Waiver 2025.pdf" should have at least 2 signer roles (volunteer + parent/guardian)
    expect(signerCount).toBeGreaterThanOrEqual(2);

    // Should produce multiple custom placements from AI detection
    expect(customCount).toBeGreaterThan(0);
  });

  test('should handle PDF upload and show builder UI correctly', async ({ page }) => {
    // Upload PDF
    await uploadPdfUntilReady(page);
    const openBuilderButton = page.getByTestId('open-builder-button');

    // Open builder
    await openBuilderButton.click();

    // Verify dialog structure
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Verify tabs are present
    await expect(page.getByRole('tab', { name: /Signers/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Fields & Signatures/i })).toBeVisible();

    // Verify AI Scan button exists
    await expect(page.getByRole('button', { name: /AI Scan/i })).toBeVisible();

    // Verify PDF viewer is loaded (check for canvas element)
    const pdfCanvas = page.locator('canvas').first();
    await expect(pdfCanvas).toBeVisible({ timeout: 10000 });
  });

  test('should retain saved configuration when reopening editor', async ({ page }) => {
    await uploadPdfUntilReady(page);

    const openBuilderButton = page.getByTestId('open-builder-button');
    await openBuilderButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.getByRole('tab', { name: /2\. Fields & Signatures/i }).click();

    const signerCountNode = page.getByTestId('waiver-summary-signer-roles');
    const customPlacementNode = page.getByTestId('waiver-summary-custom-placements');
    await expect(signerCountNode).toBeVisible();
    await expect(customPlacementNode).toBeVisible();

    const initialCustomCount = Number.parseInt((await customPlacementNode.innerText()).trim(), 10) || 0;

    const analyzeResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/ai/analyze-waiver') && resp.request().method() === 'POST',
      { timeout: 120000 }
    );

    await page.getByTestId('waiver-ai-scan-button').click();
    await analyzeResponsePromise;

    await expect
      .poll(async () => {
        const signer = Number.parseInt((await signerCountNode.innerText()).trim(), 10) || 0;
        const custom = Number.parseInt((await customPlacementNode.innerText()).trim(), 10) || 0;
        return { signer, custom };
      }, {
        timeout: 120000,
        message: 'AI scan did not produce signer/placement counts for save-reopen regression test',
      })
      .toMatchObject({
        signer: expect.any(Number),
        custom: expect.any(Number),
      });

    const scannedSignerCount = Number.parseInt((await signerCountNode.innerText()).trim(), 10) || 0;
    const scannedCustomCount = Number.parseInt((await customPlacementNode.innerText()).trim(), 10) || 0;

    expect(scannedSignerCount).toBeGreaterThanOrEqual(2);
    expect(scannedCustomCount).toBeGreaterThan(initialCustomCount);

    await page.getByRole('button', { name: /Save Configuration/i }).click();
    await expect(dialog).toBeHidden({ timeout: 20000 });

    await expect(page.getByTestId('save-result')).toBeVisible();
    await expect(page.getByTestId('save-result-signers')).toHaveText(String(scannedSignerCount));
    await expect(page.getByTestId('save-result-custom-placements')).toHaveText(String(scannedCustomCount));

    await openBuilderButton.click();
    await expect(dialog).toBeVisible();
    await page.getByRole('tab', { name: /2\. Fields & Signatures/i }).click();

    await expect(page.getByTestId('waiver-summary-signer-roles')).toHaveText(String(scannedSignerCount));
    await expect(page.getByTestId('waiver-summary-custom-placements')).toHaveText(String(scannedCustomCount));
  });
});
