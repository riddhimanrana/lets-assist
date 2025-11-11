#!/usr/bin/env node

/**
 * Test script for auto-publish hours functionality
 * 
 * Usage:
 *   node scripts/test-auto-publish.js
 * 
 * Environment variables required:
 *   - AUTO_PUBLISH_SECRET_TOKEN
 *   - NEXT_PUBLIC_SITE_URL (optional, defaults to localhost:3000)
 */

const https = require('https');
const http = require('http');

// Configuration
const SECRET_TOKEN = process.env.AUTO_PUBLISH_SECRET_TOKEN;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

if (!SECRET_TOKEN) {
  console.error('❌ Error: AUTO_PUBLISH_SECRET_TOKEN environment variable is required');
  process.exit(1);
}

// Parse URL
const url = new URL(SITE_URL);
const isHttps = url.protocol === 'https:';
const client = isHttps ? https : http;

async function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${SECRET_TOKEN}`,
        'Content-Type': 'application/json',
      }
    };

    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = client.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({
            statusCode: res.statusCode,
            data: parsed
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            data: responseData
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(data);
    }
    
    req.end();
  });
}

async function testAutoPublish() {
  console.log('🧪 Testing Auto-Publish Hours Functionality');
  console.log('=' .repeat(50));
  console.log(`📍 Site URL: ${SITE_URL}`);
  console.log(`🔑 Token: ${SECRET_TOKEN.substring(0, 8)}...`);
  console.log('');

  try {
    // Test 1: Check service status
    console.log('1️⃣ Testing service status...');
    const statusResponse = await makeRequest('GET', '/api/auto-publish-hours');
    
    if (statusResponse.statusCode === 200) {
      console.log('✅ Service is running');
      console.log(`   Enabled: ${statusResponse.data.enabled}`);
      console.log(`   Timestamp: ${statusResponse.data.timestamp}`);
    } else if (statusResponse.statusCode === 401) {
      console.log('❌ Authentication failed - check your SECRET_TOKEN');
      return;
    } else {
      console.log(`❌ Unexpected status code: ${statusResponse.statusCode}`);
      console.log(`   Response: ${JSON.stringify(statusResponse.data, null, 2)}`);
      return;
    }

    console.log('');

    // Test 2: Run auto-publish process
    console.log('2️⃣ Running auto-publish process...');
    const startTime = Date.now();
    const publishResponse = await makeRequest('POST', '/api/auto-publish-hours');
    const executionTime = Date.now() - startTime;

    if (publishResponse.statusCode === 200) {
      console.log('✅ Auto-publish completed successfully');
      console.log(`   Processed sessions: ${publishResponse.data.processedSessions}`);
      console.log(`   Successful sessions: ${publishResponse.data.successfulSessions}`);
      console.log(`   Execution time: ${publishResponse.data.executionTimeMs}ms (local: ${executionTime}ms)`);
      
      if (publishResponse.data.results && publishResponse.data.results.length > 0) {
        console.log('\n📊 Session Results:');
        publishResponse.data.results.forEach((result, index) => {
          console.log(`   Session ${index + 1}: ${result.sessionName}`);
          console.log(`     Success: ${result.success ? '✅' : '❌'}`);
          console.log(`     Certificates: ${result.certificatesCreated}`);
          console.log(`     Emails sent: ${result.emailsSent}`);
          if (result.errors && result.errors.length > 0) {
            console.log(`     Errors: ${result.errors.length}`);
            result.errors.forEach(error => {
              console.log(`       - ${error}`);
            });
          }
        });
      } else {
        console.log('   No sessions found to process (expected if no sessions are past 48 hours)');
      }
    } else {
      console.log(`❌ Auto-publish failed with status ${publishResponse.statusCode}`);
      console.log(`   Response: ${JSON.stringify(publishResponse.data, null, 2)}`);
    }

  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('   Make sure your development server is running (npm run dev)');
    } else if (error.code === 'ENOTFOUND') {
      console.log('   Check your NEXT_PUBLIC_SITE_URL - domain not found');
    }
  }

  console.log('\n🏁 Test completed');
}

// Additional helper functions
function printUsage() {
  console.log(`
Usage: node scripts/test-auto-publish.js

Environment Variables:
  AUTO_PUBLISH_SECRET_TOKEN  Required. Your auto-publish secret token
  NEXT_PUBLIC_SITE_URL       Optional. Defaults to http://localhost:3000

Examples:
  # Test against local development server
  AUTO_PUBLISH_SECRET_TOKEN=your-token node scripts/test-auto-publish.js
  
  # Test against production
  AUTO_PUBLISH_SECRET_TOKEN=your-token NEXT_PUBLIC_SITE_URL=https://your-site.com node scripts/test-auto-publish.js
`);
}

// Check if help was requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

// Run the test
testAutoPublish().catch(console.error);