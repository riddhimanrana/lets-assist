/**
 * Test script to verify timezone functionality
 * Run with: node --loader ts-node/esm timezone-test.mjs
 */

import { convertProjectTimeToUserTimezone, formatScheduleDisplay, getUserTimezone, COMMON_TIMEZONES } from './utils/timezone.js';

console.log('🌍 Testing Timezone Functionality');
console.log('===================================\n');

// Test 1: Basic timezone conversion
console.log('Test 1: Basic Timezone Conversion');
console.log('----------------------------------');

const projectTime = {
  date: '2025-12-25',
  startTime: '14:00',
  endTime: '16:00'
};

const projectTimezone = 'America/Los_Angeles';
const userTimezone = 'America/Los_Angeles';

console.log('Original project time (PST):', projectTime);
console.log('Project timezone:', projectTimezone);
console.log('User timezone:', userTimezone);

const convertedTime = convertProjectTimeToUserTimezone(projectTime, projectTimezone, userTimezone);
console.log('Converted time (EST):', convertedTime);
console.log('');

// Test 2: Format schedule display
console.log('Test 2: Schedule Display Formatting');
console.log('------------------------------------');

const displayString = formatScheduleDisplay(projectTime, projectTimezone, userTimezone, true);
console.log('Formatted display:', displayString);
console.log('');

// Test 3: Multiple timezone conversions
console.log('Test 3: Multiple Timezone Tests');
console.log('--------------------------------');

const testTimezones = [
  'America/New_York',    // EST -5
  'America/Chicago',     // CST -6 
  'America/Denver',      // MST -7
  'America/Los_Angeles', // PST -8
  'Europe/London',       // GMT +0
  'Asia/Tokyo'          // JST +9
];

testTimezones.forEach(tz => {
  const converted = convertProjectTimeToUserTimezone(projectTime, projectTimezone, tz);
  const formatted = formatScheduleDisplay(projectTime, projectTimezone, tz, true);
  console.log(`${tz}: ${formatted}`);
});

console.log('');

// Test 4: Common timezone options
console.log('Test 4: Available Timezone Options');
console.log('----------------------------------');
console.log('Number of common timezones:', COMMON_TIMEZONES.length);
COMMON_TIMEZONES.slice(0, 5).forEach(tz => {
  console.log(`- ${tz.value}: ${tz.label}`);
});

console.log('\n✅ Timezone functionality tests completed!');
console.log('\n📝 Manual testing recommendations:');
console.log('1. Create a project with timezone selection in BasicInfo');
console.log('2. Verify times display correctly in project view');
console.log('3. Test calendar integration with different timezones');
console.log('4. Check anonymous signup time display');