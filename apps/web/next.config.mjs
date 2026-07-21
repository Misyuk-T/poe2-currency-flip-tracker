import { fileURLToPath } from "node:url";

// Repo root (this file lives at apps/web/next.config.mjs). The Next app is a
// subdirectory of a single-package repo; tracing from the repo root lets the
// route handlers pull in shared src/ code and the committed catalog JSON.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // postgres.js is a server-only dependency used by the API route handlers; keep
  // it external instead of bundling the driver.
  serverExternalPackages: ["postgres"],
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    // loadCatalog() + cx-identity resolveCurrency() read these JSONs at runtime;
    // ensure they ship in the function bundle (the file tracer can miss the
    // fileURLToPath(new URL(...)) reads).
    "/api/**": ["src/data/catalog-poe2.json", "src/data/cx-identity-poe2.json"],
  },
  env: {
    // Default to same-origin so the hosted app calls its own /api/* route
    // handlers. For local dev against the always-on Node server, set
    // NEXT_PUBLIC_API_BASE_URL=/backend (proxied by the rewrite below).
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  },
  async rewrites() {
    const backendOrigin = process.env.BACKEND_ORIGIN ?? "http://localhost:8080";
    return [
      {
        source: "/backend/:path*",
        destination: `${backendOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
