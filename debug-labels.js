const fs = require('fs');
const { extractPdfTextWithPositions } = require('./lib/waiver/pdf-text-extract');
const { findLabels } = require('./lib/waiver/label-detection');

async function debugLabels() {
  const filePath = '/Users/riddhiman.rana/Desktop/Coding/lets-assist/Sample Volunteer Waiver.pdf';
  const fileBuffer = fs.readFileSync(filePath);
  const pdfData = new Uint8Array(fileBuffer);
  
  const textExtraction = await extractPdfTextWithPositions(pdfData);
  if (!textExtraction.success) {
    console.error('Text extraction failed');
    return;
  }
  
  const labels = findLabels(textExtraction.textItems);
  console.log('Detected Labels:');
  labels.forEach(l => {
    console.log(`Page ${l.pageIndex}: ${l.type} ("${l.text}") at x=${l.rect.x}, y=${l.rect.y}`);
  });
}

debugLabels();
