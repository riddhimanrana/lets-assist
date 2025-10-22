# How to Use the Schedule Editing Feature

## Quick Start Guide

### Accessing Schedule Editing

1. **Navigate to Your Project**
   - Go to the project details page
   - Click the "Edit" button (only visible to project creators)

2. **Scroll to Schedule Section**
   - After basic info fields, you'll see a separator
   - Look for the "Schedule & Timing" section with a calendar icon

3. **Review the Warning**
   - An alert box explains the implications of changing schedules
   - Important: Existing signups are preserved but volunteers may need notification

### Editing Different Event Types

#### One-Time Events
```
Schedule & Timing
─────────────────────────────────────
📅 Date Picker
🕐 Start Time
🕐 End Time
👥 Number of Volunteers
```

**Example Use Case:**
- Original: April 15, 2025, 9:00 AM - 12:00 PM, 20 volunteers
- Change to: April 15, 2025, 9:00 AM - 1:00 PM, 25 volunteers
- Click "Save Changes"

#### Multi-Day Events
```
Schedule & Timing
─────────────────────────────────────
Day 1:
  📅 Date: April 15, 2025
  
  Slot 1:
    🕐 Start: 9:00 AM
    🕐 End: 12:00 PM
    👥 Volunteers: 10
  
  Slot 2:
    🕐 Start: 1:00 PM
    🕐 End: 4:00 PM
    👥 Volunteers: 10
  
  [+ Add Slot] [Remove Day]

Day 2:
  📅 Date: April 16, 2025
  ...

[+ Add Another Day]
```

**Example Use Case:**
- Add a third day to a two-day event
- Change time slots on existing days
- Increase volunteer capacity for specific slots

#### Same-Day Multi-Area Events
```
Schedule & Timing
─────────────────────────────────────
📅 Date: April 15, 2025
🕐 Overall Start: 8:00 AM
🕐 Overall End: 5:00 PM

Role 1: Registration Desk
  🕐 Start: 8:00 AM
  🕐 End: 5:00 PM
  👥 Volunteers: 5

Role 2: Food Service
  🕐 Start: 11:00 AM
  🕐 End: 2:00 PM
  👥 Volunteers: 8

[+ Add Role]
```

**Example Use Case:**
- Add a new role/area (e.g., "Parking Attendant")
- Adjust time ranges for existing roles
- Increase capacity for busy roles

### What Happens When You Save

1. **Validation**
   - All date and time fields are checked
   - Volunteer counts must be positive numbers
   - Time ranges must be valid (start before end)

2. **Update Process**
   - Schedule is saved to database
   - Calendar events are automatically synced
   - Change tracking is reset

3. **Impact on Existing Data**
   - ✅ All signups remain valid
   - ✅ Attendance records preserved
   - ✅ Session IDs unchanged
   - ✅ Published certificate status maintained
   - ⚠️ Volunteers are NOT automatically notified

### Best Practices

#### ✅ DO:
- **Extend Hours**: Safe to add more time
- **Increase Capacity**: Always safe
- **Add Days/Slots/Roles**: No negative impact
- **Minor Time Adjustments**: Usually fine
- **Fix Typos**: Correct wrong dates/times immediately

#### ⚠️ BE CAREFUL:
- **Major Date Changes**: Could conflict with volunteer schedules
- **Reducing Time**: May affect volunteer availability
- **Changing Locations**: Update location field separately
- **Capacity Reduction**: Check current signups first

#### ❌ DON'T:
- **Reduce Below Signups**: Don't set capacity lower than current signups
- **Forget to Notify**: Manually notify volunteers of significant changes
- **Change Event Type**: Create a new project instead

### Notification Recommendations

After making schedule changes, consider:

1. **Email Volunteers**: Use your organization's email system
2. **Post Update**: Add a comment or announcement
3. **Personal Contact**: For major changes, call/text key volunteers
4. **Social Media**: If you promoted on social platforms

### Common Scenarios

#### Scenario 1: Event Runs Longer Than Expected
**Problem**: Event will take 4 hours instead of 3
**Solution**:
1. Edit end time from 12:00 PM to 1:00 PM
2. Save changes
3. Email volunteers: "Update: Event now ends at 1:00 PM"

#### Scenario 2: Need More Volunteers
**Problem**: More people want to help than expected
**Solution**:
1. Increase volunteer capacity from 20 to 30
2. Save changes
3. No notification needed (capacity increase)

#### Scenario 3: Adding Extra Day
**Problem**: Event extended to include Sunday
**Solution**:
1. Click "Add Another Day"
2. Set date, times, and capacity
3. Save changes
4. Post announcement: "Sunday added! Sign up for new slots"

#### Scenario 4: Role Timing Adjustment
**Problem**: Food service starts earlier than planned
**Solution**:
1. Edit "Food Service" start time
2. Change from 11:00 AM to 10:00 AM
3. Save changes
4. Contact food service volunteers directly

### Troubleshooting

**Changes Not Saving?**
- Check all required fields are filled
- Ensure times are in correct format
- Verify dates are valid
- Check browser console for errors

**Calendar Not Updating?**
- Wait a few seconds for sync
- Refresh the page
- Check calendar integration settings

**Save Button Disabled?**
- Make sure you've made changes
- Verify all fields are valid
- Check character limits

**Lost Your Changes?**
- Don't navigate away before saving
- Use "Cancel" to discard intentionally
- Check "Save Changes" button is enabled

### Technical Notes

- **Real-time Sync**: Changes reflect immediately after saving
- **Database**: Uses JSONB storage for flexible schedule structure
- **Validation**: Client-side and server-side checks
- **Permissions**: Only project creator can edit
- **History**: No built-in change history (coming soon)

### Support

Need help?
- Review the full technical documentation in `SCHEDULE_EDIT_FEATURE.md`
- Check project settings for permission issues
- Contact support for database/sync problems
- Report bugs via your issue tracking system

---

**Pro Tip**: Always preview your changes mentally before saving. Think about how existing volunteers will be affected and plan your communication accordingly.
