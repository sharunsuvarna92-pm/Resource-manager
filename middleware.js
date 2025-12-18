import { NextResponse } from "next/server";

/**
 * Middleware MUST NOT interfere with API routes.
 * API routes handle CORS + OPTIONS themselves.
 */
export function middleware(request) {
  const { pathname } = request.nextUrl;

  // ✅ Let all API routes pass through untouched
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // ✅ Let all other routes pass through
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
