import { redirect } from "next/navigation";

// TEMPORARY: hide the marketing landing and open straight to the dashboard.
// The landing is preserved at /app/landing/page.jsx (route: /landing).
// To restore: move app/landing/page.jsx back to app/page.jsx and delete this file.
export default function RootPage() {
  redirect("/poe2");
}
