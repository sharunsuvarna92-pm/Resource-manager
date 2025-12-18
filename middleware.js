import { NextResponse } from "next/server";

/**
 * IMPORTANT:
 * Do NOT intercept API routes.
 * API routes handle their own CORS explicitly.
 */
export function middleware(request) {
  const { pathname } = request.nextUrl;

  // ✅ Allow all API routes to pass through untouched
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // All non-API routes proceed normally
  return NextResponse.next();
}

/**
 * Explicit matcher for clarity.
 * Prevents accidental interception of static assets.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
