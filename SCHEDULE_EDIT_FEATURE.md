# Schedule Editing Feature

## Overview
Added comprehensive schedule editing capabilities to the project edit page, allowing project creators to modify dates, times, and volunteer capacity after project creation.

## Changes Made

### 1. Enhanced EditProjectClient Component
**File**: `app/projects/[id]/edit/EditProjectClient.tsx`

#### New Imports
- Added `ProjectSchedule`, `EventType` from types
- Added `Separator` component for visual separation
- Added `Schedule` component from the create flow
- Added `Calendar` icon for schedule section

#### New State Management
- `scheduleState`: Manages the schedule data (dates, times, slots, roles)
- `scheduleErrors`: Tracks validation errors for schedule fields

#### New Functions
- `initializeScheduleState()`: Helper to initialize schedule state from existing project
- Schedule update handlers:
  - `updateOneTimeSchedule()`: Updates one-time event schedule
  - `updateMultiDaySchedule()`: Updates multi-day event schedule
  - `updateMultiRoleSchedule()`: Updates same-day multi-area event schedule
  - `addMultiDaySlot()`: Adds new time slot to a day
  - `addMultiDayEvent()`: Adds new day to multi-day event
  - `addRole()`: Adds new role to same-day multi-area event
  - `removeDay()`: Removes a day from multi-day event
  - `removeSlot()`: Removes a time slot
  - `removeRole()`: Removes a role

#### Enhanced Change Detection
- Modified `hasChanges` tracking to include schedule changes
- Compares current schedule state with initial project schedule

#### Updated Form Submission
- `onSubmit()` now builds schedule object based on event type
- Includes schedule in the update payload sent to the server
- Maintains calendar event synchronization

#### New UI Components
- **Schedule Section**: Full-featured schedule editor
  - Visual separator before schedule section
  - Section header with calendar icon
  - Warning alert about implications of schedule changes
  - Reuses the same `Schedule` component from project creation
  - Supports all three event types:
    - One-time events
    - Multi-day events
    - Same-day multi-area events

## How It Works

### For One-Time Events
- Edit date, start time, end time, and volunteer capacity
- Single date picker and time inputs

### For Multi-Day Events
- Edit multiple days with their own dates
- Each day can have multiple time slots
- Add/remove days and slots
- Individual volunteer capacity per slot

### For Same-Day Multi-Area Events
- Edit overall event date and time range
- Manage multiple roles/areas
- Each role has its own time range and capacity
- Add/remove roles dynamically

## User Experience

1. **Navigate to Edit Page**: Click "Edit" button on project details page
2. **Scroll to Schedule Section**: Located after basic info and verification settings
3. **See Warning**: Alert about implications of changing schedule
4. **Edit Schedule**: Modify dates, times, slots, or roles as needed
5. **See Changes Tracked**: "Save Changes" button enables when modifications detected
6. **Save**: Submit updates - all signups and attendance records are preserved

## Important Notes

### Schedule Changes Don't Affect:
- Existing signups remain valid
- Attendance records are preserved
- Session IDs remain the same
- Published certificates status is maintained

### Recommended Practices:
1. **Notify Volunteers**: If you change dates/times significantly, manually notify volunteers
2. **Don't Reduce Capacity**: Avoid reducing volunteer slots below current signups
3. **Test Changes**: Review all fields before saving
4. **Calendar Sync**: Calendar events are automatically updated after saving

### Technical Details:
- Schedule updates use the existing `updateProject()` server action
- No database schema changes required
- Backwards compatible with existing projects
- Validates schedule data on submission
- Maintains referential integrity with signups

## Future Enhancements (Optional)

1. **Automatic Notifications**: Send notifications to signed-up volunteers when schedule changes
2. **Validation**: Prevent reducing capacity below current signup count
3. **Conflict Detection**: Warn if new times conflict with volunteer calendars
4. **Bulk Operations**: Allow copying time slots across days
5. **History Tracking**: Log schedule change history for audit purposes

## Testing Checklist

- [ ] Edit one-time event schedule
- [ ] Edit multi-day event schedule
- [ ] Edit same-day multi-area event schedule
- [ ] Add/remove days in multi-day events
- [ ] Add/remove slots in time slots
- [ ] Add/remove roles in multi-area events
- [ ] Verify signups remain valid after schedule change
- [ ] Verify attendance records preserved
- [ ] Check calendar event synchronization
- [ ] Test with projects that have existing signups
- [ ] Test with cancelled projects
- [ ] Test permission controls (only creator can edit)

## API/Database Impact

### Existing API Used:
- `updateProject(projectId, updates)` - Already supports schedule updates
- No new API endpoints required

### Database:
- No schema changes
- Uses existing `projects.schedule` JSONB column
- All schedule types supported

## Deployment Notes

1. No database migrations required
2. No environment variable changes
3. Compatible with existing data
4. Can be deployed immediately
5. Works with all existing projects

## Support

For issues or questions:
- Check Next.js 16 documentation for any proxy/middleware compatibility
- Review Supabase real-time features for notification updates
- Check calendar sync functionality if calendar events don't update
