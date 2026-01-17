# OpenGraph Images - Implementation & Testing Guide

## ✅ Current Implementation (2026 Refresh)

### Highlights

1. **Brand-first visual system** with light default and optional dark theme
2. **Dynamic imagery** for org logos and project cover images (plus org fallback)
3. **Official branding assets** via `public/logo.png`
4. **Typography** uses the default @vercel/og font (Noto Sans); add a TTF/OTF/WOFF if you want Overused Grotesk in OG
5. **Local test utility** that supports theme switching and custom base URLs

## 🎨 OpenGraph Images Created

### 1. Site-wide Default (`/app/opengraph-image.tsx`)

- **URL:** `https://lets-assist.com/opengraph-image`
- **Used for:** Homepage, any page without custom OG image
- **Shows:** Official logo, brand headline, and value props
- **Theme:** `?theme=dark` for the dark variant

### 2. Project Pages (`/app/projects/[id]/opengraph-image.tsx`)

- **URL:** `https://lets-assist.com/projects/{id}/opengraph-image`
- **Used for:** All project detail pages
- **Shows:** Organization name/logo, project title, location
- **Imagery:** `cover_image_url` when available
- **Data:** Fetched directly from Supabase REST API
- **Theme:** `?theme=dark` for the dark variant

### 3. Organization Pages (`/app/organization/[id]/opengraph-image.tsx`)

- **URL:** `https://lets-assist.com/organization/{id}/opengraph-image`
- **Used for:** All organization pages
- **Shows:** Organization logo (or initials), name, description, type
- **Data:** Fetched directly from Supabase REST API
- **Supports:** Both UUID and username routes
- **Theme:** `?theme=dark` for the dark variant

## 📊 Technical Specifications

All images meet OpenGraph standards:

- ✅ **Dimensions:** 1200×630 pixels (1.91:1 ratio)
- ✅ **Format:** PNG
- ✅ **Size:** ~140-200KB (< 8MB limit)
- ✅ **Runtime:** Edge (fast, globally distributed)
- ✅ **Caching:** Automatic via Next.js
- ✅ **Font:** Noto Sans (default in @vercel/og); custom fonts must be TTF/OTF/WOFF

## 🧪 Testing Locally

### Method 1: Direct Browser (Quickest)

1. Start dev server:

```bash
npm run dev
```

2. Open these URLs in browser:

```text
http://localhost:3000/opengraph-image
http://localhost:3000/projects/b61efe11-b00e-4848-b9c5-d9741b52ea3a/opengraph-image
http://localhost:3000/organization/{org-username}/opengraph-image
```

You should see PNG images render directly!

### Method 2: HTML Test Page

Open `og-test.html` in your browser (with dev server running):

```bash
npm run dev
open og-test.html
```

This shows all OG images with dimension verification.

**Tips:**

- Use the **Base URL** input if your dev server runs on a different port.
- Use the **Theme preview** dropdown to toggle light/dark.


### Method 3: Command Line Verification

```bash
# Test if images load
curl -I http://localhost:3000/opengraph-image

# Download and check dimensions
curl -s http://localhost:3000/opengraph-image -o test.png
sips -g pixelWidth -g pixelHeight test.png

# Should output:
# pixelWidth: 1200
# pixelHeight: 630
```

## 🌐 Testing with Social Media Validators

To test how images appear on social platforms, you need a public URL:

### Option A: Deploy to Vercel (Recommended)

1. Push changes to GitHub
2. Vercel auto-deploys (or trigger manually)
3. Use production/preview URL: `https://lets-assist.com` or preview URL

### Option B: Use ngrok Tunnel

```bash
# Install ngrok
brew install ngrok
# or
npm install -g ngrok

# Start dev server
npm run dev

# In another terminal, create tunnel
ngrok http 3000

# Copy the public URL (e.g., https://abc123.ngrok-free.app)
```

Then test on these validators:

- **Meta Tags:** [https://metatags.io](https://metatags.io)
- **OpenGraph:** [https://www.opengraph.xyz](https://www.opengraph.xyz)
- **Twitter:** [https://cards-dev.twitter.com/validator](https://cards-dev.twitter.com/validator)
- **LinkedIn:** [https://www.linkedin.com/post-inspector/](https://www.linkedin.com/post-inspector/)

### Example Test URLs

```text
https://lets-assist.com/
https://lets-assist.com/projects/b61efe11-b00e-4848-b9c5-d9741b52ea3a
https://lets-assist.com/organization/{org-username}
```

## 📋 Metadata Implementation

### Enhanced Metadata Added To

1. **Root Layout** (`app/layout.tsx`)

   - SEO keywords
   - Robot directives
   - Default OpenGraph settings
   - Twitter Card defaults

2. **Homepage** (`app/(landing)/page.tsx`)

   - Full OpenGraph tags
   - Twitter Card
   - Canonical URL
   - Extended description

3. **Project Pages** (`app/projects/[id]/page.tsx`)

   - Dynamic OG images per project
   - Project-specific keywords
   - Author attribution
   - Published time

4. **Organization Pages** (`app/organization/[id]/page.tsx`)
   - Dynamic OG images per organization
   - Profile type OpenGraph
   - Canonical URLs

## 🚀 Deployment Checklist

- [x] Fix ERR_EMPTY_RESPONSE errors
- [x] Create site-wide OG image
- [x] Create project OG images
- [x] Create organization OG images
- [x] Add comprehensive metadata
- [x] Verify 1200×630 dimensions
- [x] Test locally
- [ ] Deploy to production
- [ ] Test with social media validators
- [ ] Verify sharing on Discord/Twitter/LinkedIn
- [ ] Monitor for any issues

## 🔍 Troubleshooting

### Image not loading?

- Check dev server is running: `npm run dev`
- Update **Base URL** in `og-test.html` if your server isn’t on `:3000`
- Clear browser cache (Cmd+Shift+R)
- If you added custom fonts, ensure they are TTF/OTF/WOFF (WOFF2 isn’t supported by Satori)
- Check console for errors

### Wrong dimensions?

```bash
curl -s http://localhost:3000/opengraph-image -o test.png
sips -g pixelWidth -g pixelHeight test.png
```

Should show 1200×630

### Social platforms not showing image?

- Deploy to production first (localhost not accessible)
- Use ngrok for testing
- Some platforms cache aggressively - use their debugger tools to refresh

## 📚 Resources

- [OpenGraph Protocol](https://ogp.me/)
- [Next.js OG Image Generation](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image)
- [Satori (next/og engine)](https://github.com/vercel/satori)
- [Meta Tags Preview](https://metatags.io)

## ✨ Next Steps

1. **Deploy to production**
2. **Test with validators** (metatags.io, Twitter, LinkedIn)
3. **Share a link** on Discord/Slack to see real preview
4. **Monitor** performance and appearance

All OpenGraph images are now properly implemented and tested! 🎉
