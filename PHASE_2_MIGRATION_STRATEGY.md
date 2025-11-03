# Phase 2: Component Migration Strategy

## Overview

This document outlines the detailed strategy for migrating components from manual `getUser()` calls to the centralized `useAuth()` hook.

## Target Components (Priority Order)

### Tier 1: Critical Components (Must Migrate)

These components are used on nearly every page and cause the most redundant auth calls:

1. **Navbar.tsx** (816 lines)
   - **Current**: `initialUser` prop + `useState` + `useEffect` + `onAuthStateChange`
   - **Problem**: Makes fetchProfile call on every mount, subscribes independently
   - **Migration**: Replace with `useAuth()`, remove initialUser prop pattern
   - **Impact**: Used on every page

2. **GlobalNotificationProvider.tsx** (158 lines)
   - **Current**: Manual `getUser()` call in `checkUserStatus()`
   - **Problem**: Redundant getUser() on mount, independent subscription
   - **Migration**: Use `useAuth()` to get userId and user data
   - **Impact**: Wraps entire app, blocks onboarding modal logic

3. **NotificationListener.tsx** (171 lines)
   - **Current**: Accepts userId prop (from GlobalNotificationProvider)
   - **Problem**: Creates Supabase realtime subscriptions for each userId
   - **Migration**: Accept userId via props from parent
   - **Impact**: Handles notification subscriptions

### Tier 2: High-Impact Components

These components are used frequently and make auth calls:

4. **FeedbackDialog.tsx** (150+ lines)
   - Uses: Manual `getUser()` in effect
   - Pattern: Get user email for feedback
   - Migration: Use `useAuth()` hook

5. **DemoClientComponent.tsx** (50+ lines)
   - Uses: Manual `getUser()` on mount
   - Pattern: Basic demo component
   - Migration: Use `useAuth()` hook

6. **NotificationPopover.tsx** (100+ lines)
   - Uses: Manual `getUser()` call
   - Pattern: Get user for notification context
   - Migration: Use `useAuth()` hook

7. **InitialOnboardingModal.tsx** (200+ lines)
   - Uses: Manual `getUser()` in effect
   - Pattern: Get user metadata
   - Migration: Use `useAuth()` hook

### Tier 3: Support Components

These are used less frequently but still benefit from migration:

8. **OnboardingDebugButton.tsx** (100+ lines)
   - Uses: Multiple `getUser()` calls
   - Pattern: Debug utilities
   - Migration: Use `useAuth()` hook

9. **CancelSignupModal.tsx**
   - Uses: `createClient()` + getUser()
   - Pattern: Modal logic
   - Migration: Use `useAuth()` hook

## Migration Patterns

### Pattern 1: Simple User Access

**Before:**
```typescript
const [user, setUser] = useState<User | null>(null);

useEffect(() => {
  const supabase = createClient();
  supabase.auth.getUser().then(({ data: { user } }) => {
    setUser(user);
  });
}, []);
```

**After:**
```typescript
const { user } = useAuth();
```

### Pattern 2: Loading & Error States

**Before:**
```typescript
const [user, setUser] = useState<User | null>(null);
const [isLoading, setIsLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  setIsLoading(true);
  const supabase = createClient();
  supabase.auth.getUser()
    .then(({ data: { user } }) => {
      setUser(user);
      setError(null);
    })
    .catch(err => setError(err))
    .finally(() => setIsLoading(false));
}, []);
```

**After:**
```typescript
const { user, isLoading, isError, error } = useAuth();
```

### Pattern 3: Auth State Changes (Navbar Pattern)

**Before:**
```typescript
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (event, session) => {
      if (session?.user) {
        setUser(session.user);
      } else {
        setUser(null);
      }
    }
  );
  
  return () => subscription.unsubscribe();
}, [supabase]);
```

**After:**
```typescript
// Hook automatically subscribes and handles state changes
const { user } = useAuth();
```

### Pattern 4: Passing User Context to Children

**Before (GlobalNotificationProvider → NotificationListener):**
```typescript
// GlobalNotificationProvider
const [userId, setUserId] = useState<string | null>(null);
// ... logic to set userId ...
<NotificationListener userId={userId} />

// NotificationListener
export function NotificationListener({ userId }: { userId: string }) {
  // Use userId
}
```

**After:**
```typescript
// GlobalNotificationProvider - can still pass userId to children
const { user } = useAuth();
<NotificationListener userId={user?.id} />

// NotificationListener - same pattern, just different source
export function NotificationListener({ userId }: { userId: string | undefined }) {
  // Use userId
}
```

## Migration Checklist

For each component, follow this checklist:

- [ ] Remove `useState` for user, isLoading, isError, error
- [ ] Remove manual `useEffect` that calls `getUser()`
- [ ] Remove manual `onAuthStateChange` subscription
- [ ] Remove `createClient()` for auth purposes
- [ ] Add `import { useAuth } from '@/hooks/useAuth'`
- [ ] Add `const { user, isLoading, isError, error } = useAuth()` at start of component
- [ ] Replace all `user` references with hook value
- [ ] Replace all `isLoading` references with hook value
- [ ] Update TypeScript types if needed
- [ ] Remove now-unused imports (useState for this purpose, useEffect cleanup if no other effects)
- [ ] Test loading, authenticated, and unauthenticated states
- [ ] Test logout → re-login flow
- [ ] Verify no console errors

## Implementation Schedule

### Phase 2.1: Navbar & GlobalNotificationProvider
1. Migrate Navbar.tsx
2. Migrate GlobalNotificationProvider.tsx
3. Update NotificationListener.tsx to work with new pattern
4. Test together

### Phase 2.2: High-Impact Components
1. Migrate FeedbackDialog.tsx
2. Migrate DemoClientComponent.tsx
3. Migrate NotificationPopover.tsx
4. Migrate InitialOnboardingModal.tsx

### Phase 2.3: Support Components
1. Migrate OnboardingDebugButton.tsx
2. Migrate CancelSignupModal.tsx
3. Other components as needed

### Phase 2.4: Bulk Migration
1. Identify remaining components
2. Create script/helper for bulk migration
3. Migrate all remaining 20+ components

## Expected Benefits

**Per Component Saved:**
- 10-20 lines of code removed
- 1 `getUser()` call eliminated
- 1 `onAuthStateChange` subscription eliminated

**Overall Impact:**
- 200+ lines of code removed (across all components)
- 30-40 redundant `getUser()` calls eliminated
- Single centralized auth subscription
- Improved maintainability
- Easier testing

## Backward Compatibility

✅ **No breaking changes** - Old manual patterns still work
✅ **Gradual migration** - Can migrate components incrementally
✅ **No prop changes** - Components can still accept user as prop if needed
✅ **Testing** - Existing tests continue to work

## Rollback Plan

If issues arise:
1. Revert the component file to previous version
2. Component will continue working with `createClient()` pattern
3. No database migrations needed
4. No auth state corrupted

## Success Metrics

- [ ] All Tier 1 components migrated
- [ ] All Tier 2 components migrated
- [ ] 50+ lines of code removed
- [ ] 20+ `getUser()` calls eliminated
- [ ] Zero regressions in auth flow
- [ ] All tests passing
- [ ] No console errors on pages with migrated components

---

Next step: Start with Navbar.tsx migration
