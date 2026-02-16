import { test, expect, type Locator, type Page } from '@playwright/test';
import path from 'path';

const PDF_PATH = path.resolve(process.cwd(), 'Volunteer Waiver 2025.pdf');
const TEST_HARNESS_URL = '/test-harness/waiver-signer';

async function uploadPdfAndOpenSignerDialog(page: Page) {
  await page.goto(TEST_HARNESS_URL);
  await expect(page.getByTestId('waiver-signer-test-harness')).toBeVisible();

  const fileInput = page.getByTestId('signer-pdf-upload-input');
  const openButton = page.getByTestId('open-signer-dialog-button');

  for (let attempt = 0; attempt < 3; attempt++) {
    await fileInput.setInputFiles([]);
    await fileInput.setInputFiles(PDF_PATH);

    try {
      await expect(openButton).toBeEnabled({ timeout: 12000 });
      break;
    } catch {
      if (attempt === 2) {
        throw new Error('PDF upload did not enable signer dialog button after retries.');
      }
    }
  }

  await openButton.click();

  await expect(page.getByTestId('waiver-signer-dialog')).toBeVisible();
}

async function drawSignature(page: Page, canvas: Locator) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Signature canvas not visible');

  const startX = box.x + 20;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 40, startY - 15);
  await page.mouse.move(startX + 90, startY + 10);
  await page.mouse.move(startX + 140, startY - 8);
  await page.mouse.up();
}

async function goToVolunteerSignStep(page: Page) {
  // Review step
  await page.getByTestId('waiver-consent-checkbox').click();
  await expect(page.getByTestId('waiver-signer-next')).toBeEnabled();
  await page.getByTestId('waiver-signer-next').click();

  // Global fields step
  await expect(page.getByTestId('waiver-field-input-global_email')).toBeVisible();
  await page.getByTestId('waiver-field-input-global_email').fill('volunteer@example.com');
  await page.getByTestId('waiver-signer-next').click();

  // Volunteer fields step
  await expect(page.getByTestId('waiver-field-input-volunteer_full_name')).toBeVisible();
  await page.getByTestId('waiver-field-input-volunteer_full_name').fill('Alex Volunteer');
  await page.getByTestId('waiver-signer-next').click();

  // Volunteer sign step
  await expect(page.getByRole('heading', { name: 'Sign as Volunteer' })).toBeVisible();
}

test.describe('Waiver Signer Views E2E', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (message) => {
      if (message.type() === 'error') {
        console.error('Browser console error:', message.text());
      }
    });
  });

  test('completes signer flow with draw + typed signatures', async ({ page }) => {
    await uploadPdfAndOpenSignerDialog(page);
    await goToVolunteerSignStep(page);

    const nextButton = page.getByTestId('waiver-signer-next');
    await expect(nextButton).toBeDisabled();

    // Draw first signature
    const drawCanvas = page.getByTestId('signature-draw-canvas');
    await expect(drawCanvas).toBeVisible();
    await drawSignature(page, drawCanvas);

    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    // Guardian sign step: use typed signature mode
    await expect(page.getByRole('heading', { name: 'Sign as Parent/Guardian' })).toBeVisible();
    await page.getByTestId('signature-tab-typed').click();
    await page.getByTestId('signature-typed-input').fill('Taylor Guardian');

    const completeButton = page.getByTestId('waiver-signer-complete');
    await expect(completeButton).toBeEnabled();
    await completeButton.click();

    // Result summary from harness callback
    await expect(page.getByTestId('signer-submit-result')).toBeVisible();
    await expect(page.getByTestId('signer-result-signature-type')).toHaveText('multi-signer');
    await expect(page.getByTestId('signer-result-signer-count')).toHaveText('2');

    const methodsText = await page.getByTestId('signer-result-methods').innerText();
    expect(methodsText).toContain('draw');
    expect(methodsText).toContain('typed');
  });

  test('disables progression when drawn signature is cleared', async ({ page }) => {
    await uploadPdfAndOpenSignerDialog(page);
    await goToVolunteerSignStep(page);

    const nextButton = page.getByTestId('waiver-signer-next');
    await expect(nextButton).toBeDisabled();

    const drawCanvas = page.getByTestId('signature-draw-canvas');
    await drawSignature(page, drawCanvas);
    await expect(nextButton).toBeEnabled();

    await page.getByTestId('signature-clear-button').click();
    await expect(nextButton).toBeDisabled();
  });
});
