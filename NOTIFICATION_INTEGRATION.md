# Notification Integration Summary

This document outlines the notification integration added to the admin and volunteer hours publishing systems.

## Features Added

### 1. Trusted Member Application Notifications

When an admin approves or denies a trusted member application via the `/admin` dashboard, the applicant receives an in-app notification.

#### Approval Notification
- **Title**: "Trusted Member Application Approved! 🎉"
- **Body**: "Congratulations! Your trusted member application has been approved. You can now create projects and organizations."
- **Severity**: `success` (green indicator)
- **Action URL**: `/home`

#### Denial Notification
- **Title**: "Trusted Member Application Update"
- **Body**: "Thank you for your interest in becoming a trusted member. Unfortunately, your application was not approved at this time. Please contact support for more information."
- **Severity**: `warning` (yellow indicator)
- **Action URL**: `/contact`

**Implementation**: `app/admin/actions.ts` - `updateTrustedMemberStatus()` function

### 2. Volunteer Hours Published Notifications

When volunteer hours are published (either manually or via auto-publish), volunteers receive an in-app notification about their certificate.

#### Certificate Published Notification
- **Title**: "Your Volunteer Hours Have Been Published! 🎉"
- **Body**: "Your volunteer certificate for \"{project_title}\" is now available. You volunteered for X hours and Y minutes."
- **Type**: `project_updates`
- **Severity**: `success` (green indicator)
- **Action URL**: `/certificates/{certificate_id}`

**Implementations**:
1. **Manual Publishing**: `app/projects/[id]/hours/actions.ts` - `publishVolunteerHours()` function
2. **Auto-Publishing**: `app/api/auto-publish-hours/route.ts` - Added after certificate creation

## Technical Details

### Server-Side Notification Creation

A helper function was added to `app/admin/actions.ts` for creating notifications from server actions:

```typescript
async function createServerNotification(
  userId: string,
  title: string,
  body: string,
  severity: NotificationSeverity = 'info',
  actionUrl?: string
)
```

This function:
- Inserts directly into the `notifications` table
- Sets `type: 'general'` for admin notifications
- Sets `displayed: false` and `read: false` to trigger real-time listener
- Handles errors gracefully without blocking the main operation

### Notification Flow

1. **Notification Creation**: Server action inserts into `notifications` table
2. **Real-time Detection**: `NotificationListener.tsx` component (mounted in `GlobalNotificationProvider.tsx`) detects new notifications via Supabase Realtime
3. **Toast Display**: Listener shows a toast notification to the user
4. **Popover Badge**: `NotificationPopover.tsx` updates the unread count badge
5. **User Interaction**: User can click the notification to navigate to the action URL

### Only Registered Users Receive Notifications

For volunteer hours published notifications, the code filters to only send to registered users:

```typescript
.filter(v => v.userId) // Only send to registered users
```

Anonymous volunteers will still receive email notifications (if email is provided) but won't get in-app notifications.

## User Experience

### Real-time Delivery
- Notifications appear instantly via Supabase Realtime subscriptions
- Toast notifications appear in the bottom-right corner
- Unread badge updates automatically in the navbar

### Notification Types
- **Success** (green): Approvals, published certificates
- **Warning** (yellow): Denials, important updates
- **Info** (blue): General information

### User Preferences
Notifications respect user preferences stored in `notification_settings` table:
- `project_updates`: Controls volunteer hours notifications
- `general`: Controls general system notifications
- Users can manage preferences at `/account/notifications`

## Testing

### Test Trusted Member Notifications
1. Go to `/admin` (must be super admin)
2. Find a pending trusted member application
3. Click "Approve" or "Deny"
4. The applicant should receive an instant notification

### Test Volunteer Hours Notifications
1. **Manual Publishing**:
   - Go to a project's hours management page
   - Publish volunteer hours for a session
   - Registered volunteers should receive notifications

2. **Auto-Publishing**:
   - Wait for the auto-publish cron job to run (48-72 hours after checkout)
   - OR manually trigger: `POST /api/auto-publish-hours` with proper auth
   - All registered volunteers with valid hours should receive notifications

## Files Modified

1. `/app/admin/actions.ts` - Added notification creation for trusted member status updates
2. `/app/projects/[id]/hours/actions.ts` - Added notifications for manual hour publishing
3. `/app/api/auto-publish-hours/route.ts` - Added notifications for auto-publish

## Future Enhancements

Potential improvements:
- Add notification preferences for trusted member updates
- Include project image in notification
- Add notification history/archive view
- Allow users to configure quiet hours
- Add digest mode (daily summary instead of instant)
