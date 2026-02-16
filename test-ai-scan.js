const fs = require('fs');
const path = require('path');

async function testScan() {
  try {
    const filePath = '/Users/riddhiman.rana/Desktop/Coding/lets-assist/Sample Volunteer Waiver.pdf';
    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: 'application/pdf' });
    
    // In Node.js environment, we can just use the Buffer directly with FormData if needed,
    // or use the Global File object if available.
    const file = new File([blob], 'Sample Volunteer Waiver.pdf', { type: 'application/pdf' });

    const formData = new FormData();
    formData.append('file', file);

    console.log('Sending request to AI scan API...');
    const response = await fetch('http://localhost:3000/api/ai/analyze-waiver', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
        const text = await response.text();
        console.error(`Error: ${response.status} ${response.statusText}`);
        console.error(text);
        return;
    }

    const data = await response.json();
    console.log('Result:');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Test failed:', err);
  }
}

testScan();
