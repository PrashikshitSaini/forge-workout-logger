import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 "proxy" convention (formerly "middleware"). Refreshes the Supabase
// session on every request and guards routes.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on every path except API routes (they do their own auth and must
     * return 401/503, never a redirect), static assets, and public files
     * (manifest, service worker, icons, images).
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
