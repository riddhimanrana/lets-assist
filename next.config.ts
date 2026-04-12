import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: false,

  // pdfjs-dist uses browser-only APIs (DOMMatrix, Path2D, ImageData) that are unavailable
  // in the serverless bundle. Marking it external makes Next.js load it at runtime via
  // require() instead of bundling it, so instrumentation.ts polyfills apply first.
  serverExternalPackages: ['pdfjs-dist'],
  transpilePackages: ['la-plugin-dv-speech-debate'],

  experimental: {
    serverActions: {
      bodySizeLimit: '15mb',
    },
  },
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
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "54321",
        pathname: "/**",
      }
    ],
  },
};

export default nextConfig;
