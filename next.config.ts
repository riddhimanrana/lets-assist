import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: false,

  // pdfjs-dist uses browser-only APIs (DOMMatrix, Path2D, ImageData) that are unavailable
  // in the serverless bundle. Marking it external makes Next.js load it at runtime via
  // require() instead of bundling it, so instrumentation.ts polyfills apply first.
  serverExternalPackages: ['pdfjs-dist'],

  experimental: {
    serverActions: {
      bodySizeLimit: '15mb',
    },
  },

  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "https://us.i.posthog.com/decide",
      },
    ];
  },
  skipTrailingSlashRedirect: true, // This is required to support PostHog trailing slash API requests
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.googleusercontent.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "fotdmeakexgrkronxlof.supabase.co",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "api.lets-assist.com", // supabase custom domain
        pathname: "/**",
      }
    ],
  },
};

export default nextConfig;
