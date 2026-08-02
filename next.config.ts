import type { NextConfig } from "next";

const requestedDistDir = process.env.NEXT_DIST_DIR?.trim();
const isolatedDistDirs = new Set([
  ".next-csf-isolated/browser-app",
  ".next-csf-isolated/cron-probe",
]);
if (requestedDistDir && !isolatedDistDirs.has(requestedDistDir)) {
  throw new Error(
    `Unsupported NEXT_DIST_DIR ${JSON.stringify(requestedDistDir)}. ` +
      "Only an isolated CSF child may select an alternate Next.js output directory.",
  );
}

const nextConfig: NextConfig = {
  // Next 16 locks each development output directory. The CSF runner uses a
  // separate directory so it can coexist with the developer's normal server.
  distDir: requestedDistDir || ".next",
  cacheComponents: false,

  // Playwright and agent-browser use the loopback host so the app and local
  // Supabase share an origin. Keep this host-only allowlist narrow; Next.js
  // intentionally blocks other cross-site development origins.
  allowedDevOrigins: ["127.0.0.1"],

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
    qualities: [75, 85],
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
