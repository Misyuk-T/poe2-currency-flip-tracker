import { permanentRedirect } from "next/navigation";

// The dashboard, not the marketing landing, is the entry point (2026-06-29).
// 308 rather than 307: `/` is the URL people link and search engines treat as
// the site's identity, so the hop to /poe2 has to consolidate onto it instead
// of being re-evaluated on every crawl.
// The landing is preserved at /app/landing/page.jsx (route: /landing).
// To restore: move app/landing/page.jsx back to app/page.jsx and delete this file.
export default function RootPage() {
  permanentRedirect("/poe2");
}
