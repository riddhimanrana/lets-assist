# Multi-Day Event Per-Day Signup Feature

## Overview
This feature allows users to sign up for multi-day events on a per-day basis, even after some days have already passed. Previously, once the first day of a multi-day event passed, the entire event was marked as "completed" and no further signups were allowed.

## Implementation Date
January 22, 2025

## Problem Solved
**Before:** 
- Multi-day event: Monday, Tuesday, Wednesday, Thursday
- After Monday passes → entire event becomes "past" → no more signups allowed for Tue-Thu

**After:**
- Monday passes → Monday slot closed, but Tue/Wed/Thu still open for signups
- Each day closes for signups only after that specific day's end time has passed

## Changes Made

### 1. Helper Functions (`utils/project.ts`)

Added three new helper functions:

#### `isMultiDaySlotPast(day)`
Checks if a specific day in a multi-day event has passed by comparing the last slot's end time with the current time.

```typescript
export function isMultiDaySlotPast(day: { date: string; slots: Array<{endTime: string}> }): boolean
```

#### `getAvailableMultiDaySlots(project)`
Returns an array of day indices that are still available for signup (haven't passed yet).

```typescript
export function getAvailableMultiDaySlots(project: Project): number[]
```

#### `hasAvailableMultiDaySlots(project)`
Returns true if ANY day is still available for signup.

```typescript
export function hasAvailableMultiDaySlots(project: Project): boolean
```

### 2. Project Status Calculation (`utils/project.ts`)

Updated `getProjectStatus()` to handle multi-day events specially:
- For multi-day events, checks if any days are still available
- Only marks as "completed" when ALL days have passed
- Correctly identifies "in-progress" status when any slot is currently active
- Falls back to "upcoming" when days are available but none are currently active

### 3. Server-Side Validation (`app/projects/[id]/actions.ts`)

Added validation in the signup action to prevent signups for past time slots:
- Parses the schedule ID to extract the date and slot index
- Calculates the slot's end time
- Returns error if the slot has already passed

```typescript
// For multiDay events, validate that the specific day/slot hasn't passed
if (project.event_type === "multiDay" && project.schedule.multiDay) {
  // ... validation logic
  if (isAfter(new Date(), slotEndDateTime)) {
    return { error: "This time slot has already passed" };
  }
}
```

### 4. UI Updates (`app/projects/[id]/ProjectDetails.tsx`)

Enhanced the multi-day event display:
- Shows a "Passed" badge next to dates that have ended
- Grays out past days with 50% opacity
- Disables signup buttons for past days
- Changes button text to "Time Passed" for past slots
- Maintains all existing functionality for available days

Visual changes:
```tsx
{isDayPast && (
  <Badge variant="secondary" className="ml-2">
    Passed
  </Badge>
)}
```

## Technical Details

### Date/Time Handling
- Uses `date-fns` library for reliable date parsing and comparison
- Properly handles timezone-aware comparisons
- Accounts for the last slot's end time to determine if a day has passed

### Backward Compatibility
- No database schema changes required
- Existing multi-day events work without modifications
- Does not affect oneTime or sameDayMultiArea event types

### Data Flow
1. User visits project page
2. `getProjectStatus()` calculates current status using new logic
3. `ProjectDetails` component renders days with visual indicators
4. User attempts signup → server validates slot hasn't passed
5. If valid, signup proceeds as before

## Benefits

1. **User Flexibility**: Users can join multi-day events mid-week
2. **Better UX**: Clear visual feedback about which days are available
3. **Accurate Status**: Project status correctly reflects partial completion
4. **Data Integrity**: Each day tracked separately (already supported by schema)
5. **Minimal Changes**: Leverages existing data structure

## Files Modified

- `utils/project.ts` - Added helper functions and updated status logic
- `app/projects/[id]/actions.ts` - Added server-side validation
- `app/projects/[id]/ProjectDetails.tsx` - Updated UI display
- `app/home/actions.ts` - Automatically uses updated status logic

## Testing Recommendations

1. Create a multi-day event spanning several days
2. Verify first day shows as available before it passes
3. Wait for first day to pass, confirm it shows "Passed" badge
4. Verify remaining days still show signup buttons
5. Attempt to sign up for a past day (should fail with error message)
6. Confirm successful signup for future days
7. Test edge cases: same-day with past start time, events spanning midnight

## Future Enhancements

Potential improvements for future consideration:
- Show countdown timer for current day's remaining time
- Send reminder notifications as each day approaches
- Allow partial attendance certificates for users who only attended some days
- Add "Today" badge for the current day in multi-day events
