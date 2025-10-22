# Media & Documents Integration

## Overview
Integrated file management (cover images and documents) directly into the project edit page, replacing the separate `/projects/[id]/documents` route.

## Changes Made

### ✅ Consolidated UI
- **Removed**: Separate "Manage Files" route and button
- **Added**: Collapsible "Media & Documents" section in Edit Project page
- **Benefits**: 
  - All project editing in one place
  - Better UX - no need to navigate between pages
  - Consistent design with Schedule section

### ✅ Features

#### Cover Image
- Upload cover image (JPEG, PNG, WebP, max 5MB)
- 16:9 aspect ratio display
- Click or drag-and-drop to upload
- Preview with delete button overlay
- Automatic storage in Supabase `project-images` bucket

#### Supporting Documents
- Upload up to 5 documents (PDF, Word, Text, Images)
- Maximum total size: 10MB
- Multiple file upload support
- Document list with:
  - File icons by type
  - File name and size display
  - Preview button (for PDF and images)
  - Delete button with hover effect
- Real-time size tracking

### ✅ File Management
- **Validation**: Type and size checks before upload
- **Storage**: Supabase Storage buckets
  - `project-images`: Cover images
  - `project-documents`: Supporting documents
- **Preview**: In-app preview for PDFs and images using FilePreview component
- **Deletion**: Removes from both storage and database

### 🎨 Design
- Collapsible section (closed by default)
- Clean drag-and-drop areas
- Consistent with existing edit page design
- Responsive layout
- Visual feedback on hover and drag

### 📁 Files Modified
- `app/projects/[id]/edit/EditProjectClient.tsx` (+240 lines)
  - Added media upload handlers
  - Added file validation
  - Added collapsible UI section
  - Integrated FilePreview component
- `app/projects/[id]/CreatorDashboard.tsx`
  - Removed "Manage Files" button

### 📁 Files to Remove (optional cleanup)
- `app/projects/[id]/documents/page.tsx`
- `app/projects/[id]/documents/DocumentsClient.tsx`

These can be safely deleted as all functionality is now in the Edit page.

## Usage

### For Users
1. Navigate to project → Click "Edit"
2. Scroll to "Media & Documents" section
3. Click to expand
4. Upload cover image and/or documents
5. Preview or delete existing files
6. Changes save automatically on upload/delete

### For Developers
- Uses existing `updateProject()` server action
- No new API endpoints required
- No database schema changes
- Type-safe with TypeScript
- Follows existing upload patterns

## Technical Details

### Validation Rules
```typescript
// Cover Image
- Types: JPEG, PNG, WebP, JPG
- Max size: 5MB per image

// Documents
- Types: PDF, Word, Text, Images
- Max files: 5 documents
- Max total size: 10MB
- Multiple upload: Yes
```

### Storage Buckets
```
project-images/
  ├── project_{id}_cover_{timestamp}.{ext}

project-documents/
  ├── project_{id}_doc_{timestamp}_{random}.{ext}
```

### Type Interface
```typescript
interface ProjectDocument {
  name: string;
  originalName: string;
  type: string;
  size: number;
  url: string;
}
```

## Benefits
1. **Better UX**: Single page for all editing
2. **Cleaner Navigation**: Fewer routes to manage
3. **Consistent Design**: Matches Schedule section pattern
4. **Space Efficient**: Collapsible when not needed
5. **No Breaking Changes**: Existing data works as-is
