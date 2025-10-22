# Slot-Level Availability for All Event Types

## Update Date
January 22, 2025

## Problem Fixed
After the initial multi-day per-day signup implementation, we discovered that the "in-progress" project status was disabling ALL signup buttons when ANY slot was currently active. This prevented users from signing up for upcoming slots within the same event.

### Example Scenario:
- Event on Thursday with two slots:
  - Slot 1: 4:00 PM - 5:00 PM
  - Slot 2: 5:30 PM - 6:30 PM
- At 4:30 PM, Slot 1 is "in-progress"
- Result: Slot 2's signup button was DISABLED even though it hasn't started yet ❌

## Solution
Changed from **project-level status checking** to **slot-level availability checking**. Each slot is now evaluated independently based on its own end time.

## Implementation

### New Helper Functions Added to `utils/project.ts`

#### 1. `isMultiDaySlotPastByScheduleId(project, scheduleId)`
Checks if a specific slot within a multi-day event has passed by parsing the schedule ID and checking that slot's end time.

```typescript
export function isMultiDaySlotPastByScheduleId(project: Project, scheduleId: string): boolean
```

#### 2. `isSameDayMultiAreaSlotPast(project, scheduleId)`
Checks if a specific role/slot within a sameDayMultiArea event has passed.

```typescript
export function isSameDayMultiAreaSlotPast(project: Project, scheduleId: string): boolean
```

#### 3. `isOneTimeSlotPast(project)`
Checks if a oneTime event slot has passed.

```typescript
export function isOneTimeSlotPast(project: Project): boolean
```

### Changes to `ProjectDetails.tsx`

**Before (Project-level check):**
```typescript
disabled={
  isCreator || 
  calculatedStatus === "cancelled" || 
  calculatedStatus === "completed" || 
  calculatedStatus === "in-progress" ||  // ❌ Blocks all slots
  // ...
}
```

**After (Slot-level check):**
```typescript
// For oneTime
disabled={
  isCreator || 
  calculatedStatus === "cancelled" || 
  isOneTimeSlotPast(project) ||  // ✅ Only this slot
  // ...
}

// For multiDay
disabled={
  isCreator || 
  calculatedStatus === "cancelled" || 
  isMultiDaySlotPastByScheduleId(project, scheduleId) ||  // ✅ Only this slot
  // ...
}

// For sameDayMultiArea
disabled={
  isCreator || 
  calculatedStatus === "cancelled" || 
  isSameDayMultiAreaSlotPast(project, role.name) ||  // ✅ Only this slot
  // ...
}
```

## Behavior by Event Type

### 1. OneTime Events
- Single slot with start and end time
- Signup disabled only after the slot's end time passes
- Shows "Time Passed" button text when expired

### 2. MultiDay Events
- Multiple days, each with multiple slots
- Each slot evaluated independently
- Day shows "Passed" badge only when ALL its slots have passed
- Slot A at 4 PM passing doesn't affect Slot B at 5:30 PM on the same day ✅

### 3. SameDayMultiArea Events
- Multiple roles/areas on the same day
- Each role has its own start/end time
- Each role's signup availability is independent
- Role A ending doesn't disable Role B that starts later ✅

## Visual Feedback

### Slot-Level Indicators
- **Active slot**: Normal display, signup available (unless other conditions like "full")
- **Past slot**: 
  - Button text changes to "Time Passed"
  - Button is disabled
  - Reduced opacity (50%)
  - Grayed out appearance

### Day-Level Indicators (MultiDay only)
- Shows "Passed" badge only when ALL slots in that day have ended
- Day gets 50% opacity when all slots have passed
- Individual slots within a day can still be active/future

## Edge Cases Handled

1. **Overlapping Slots**: Not possible in current schema, but if they were, each would be evaluated independently
2. **Same-Day Multiple Slots**: Each slot checked against its own end time
3. **Midnight Crossing**: Date-time parsing handles this correctly
4. **Timezone Handling**: Uses proper date-fns parsing with timezone awareness

## Testing Checklist

- [x] Build successful (TypeScript compilation passed)
- [x] oneTime events: Can't sign up after end time
- [x] multiDay events: Can sign up for future slots even if earlier slots on same day passed
- [x] sameDayMultiArea events: Can sign up for later roles even if earlier roles passed
- [x] Visual indicators work correctly (opacity, "Time Passed" text)
- [x] Day-level "Passed" badge only shows when ALL slots passed

## Files Modified

1. **`utils/project.ts`**
   - Added `isMultiDaySlotPastByScheduleId()`
   - Added `isSameDayMultiAreaSlotPast()`
   - Added `isOneTimeSlotPast()`

2. **`app/projects/[id]/ProjectDetails.tsx`**
   - Updated oneTime button logic to use slot-specific check
   - Updated multiDay button logic to use slot-specific check
   - Updated sameDayMultiArea button logic to use slot-specific check
   - Updated day-level badge logic to check ALL slots

## Benefits

✅ **Flexible signups**: Users can join later slots even if earlier ones have passed  
✅ **Accurate status**: Each slot's availability accurately reflects its own timing  
✅ **Better UX**: No confusing "disabled" state for future slots  
✅ **Real-world usage**: Matches how multi-slot events actually work  
✅ **Independent slots**: Each slot's availability is self-contained  

## Example Scenarios

### Scenario 1: Multi-Day Event
- **Monday 9 AM-12 PM**: Passed ❌
- **Monday 2 PM-5 PM**: Available ✅
- **Tuesday 9 AM-12 PM**: Available ✅
- **Result**: Can still sign up for Monday 2 PM and all Tuesday slots

### Scenario 2: Same-Day Multi-Area
- **Registration Desk 8 AM-10 AM**: Passed ❌
- **Food Service 11 AM-2 PM**: Available ✅
- **Cleanup 3 PM-5 PM**: Available ✅
- **Result**: Can still sign up for Food Service and Cleanup

### Scenario 3: Multi-Day with Multiple Slots
- **Thursday 4 PM-5 PM**: In progress (4:30 PM now) 🟡
- **Thursday 5:30 PM-6:30 PM**: Available ✅
- **Result**: Can sign up for 5:30 PM slot even though 4 PM slot is active

## Related Documentation

- See `MULTIDAY_SIGNUP_FEATURE.md` for the initial per-day signup implementation
- Both features work together to provide granular signup control
