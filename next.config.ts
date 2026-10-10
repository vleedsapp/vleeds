import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

/**
 * Development-only UI fixture routes (`page.fixture.tsx`) exist only when the
 * build/dev server runs with VLEEDS_UI_FIXTURES=1. They are never part of a
 * normal build, and enabling them for a Vercel production deploy is refused.
 */
const uiFixtures = process.env.VLEEDS_UI_FIXTURES === "1";
if (uiFixtures && process.env.VERCEL_ENV === "production") {
  throw new Error("VLEEDS_UI_FIXTURES must never be enabled for a production deployment.");
}

const nextConfig: NextConfig = {
  pageExtensions: uiFixtures ? ["fixture.tsx", "tsx", "ts"] : ["tsx", "ts"],
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // CSV imports accept files up to 5 MB (src/lib/imports/limits.ts) plus multipart overhead.
      bodySizeLimit: "6mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
