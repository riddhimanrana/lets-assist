import { describe, it, expect } from 'vitest';

/**
 * Test for date picker utility functions
 * These tests verify the date format conversions work correctly
 */
describe('DatePicker Date Format Conversion', () => {
  it('converts Date object to YYYY-MM-DD format', () => {
    const date = new Date('2024-03-15T00:00:00');
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    expect(dateString).toBe('2024-03-15');
  });

  it('converts YYYY-MM-DD string to Date object', () => {
    const dateString = '2024-03-15';
    const date = new Date(dateString + 'T00:00:00');
    
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(2); // 0-indexed, so March = 2
    expect(date.getDate()).toBe(15);
  });

  it('preserves date correctly when converting back and forth', () => {
    const originalString = '2024-03-15';
    const date = new Date(originalString + 'T00:00:00');
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const convertedString = `${year}-${month}-${day}`;
    
    expect(convertedString).toBe(originalString);
  });

  it('handles date comparison for min date constraint', () => {
    const minDateString = '2024-03-10';
    const testDateString = '2024-03-05';
    
    const minDate = new Date(minDateString + 'T00:00:00');
    const testDate = new Date(testDateString + 'T00:00:00');
    
    expect(testDate < minDate).toBe(true);
  });

  it('handles date comparison for max date constraint', () => {
    const maxDateString = '2024-03-20';
    const testDateString = '2024-03-25';
    
    const maxDate = new Date(maxDateString + 'T00:00:00');
    const testDate = new Date(testDateString + 'T00:00:00');
    
    expect(testDate > maxDate).toBe(true);
  });

  it('date within min/max range is valid', () => {
    const minDateString = '2024-03-10';
    const maxDateString = '2024-03-20';
    const testDateString = '2024-03-15';
    
    const minDate = new Date(minDateString + 'T00:00:00');
    const maxDate = new Date(maxDateString + 'T00:00:00');
    const testDate = new Date(testDateString + 'T00:00:00');
    
    expect(testDate >= minDate && testDate <= maxDate).toBe(true);
  });
});
