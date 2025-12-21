import { NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://resource-manager-zeta.vercel.app",
];

function setCorsHeaders(response, origin) {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  response.headers.set("Access-Control-Allow-Credentials", "true");
}

export function middleware(request) {
  const pathname = request.nextUrl.pathname;
  const origin = request.headers.get("origin");

  // Only API routes
  if (!pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // ✅ SAME-ORIGIN REQUEST (no Origin header)
  if (!origin) {
    // Let it pass untouched — NO CORS headers
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.next();
  }

  // ❌ Cross-origin but not allowed
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new NextResponse("CORS origin not allowed", { status: 403 });
  }

  // 🔁 Preflight
  if (request.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    setCorsHeaders(res, origin);
    return res;
  }

  // Normal request
  const res = NextResponse.next();
  setCorsHeaders(res, origin);
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
