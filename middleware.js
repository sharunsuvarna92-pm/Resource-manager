import { NextResponse } from "next/server";

function setCorsHeaders(res, origin) {
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.headers.set("Access-Control-Allow-Credentials", "true");
}

export function middleware(request) {
  const pathname = request.nextUrl.pathname;
  const origin = request.headers.get("origin");

  // Only API routes
  if (!pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // SAME-ORIGIN or non-browser (no Origin header)
  if (!origin) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.next();
  }

  // PREFLIGHT
  if (request.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    setCorsHeaders(res, origin);
    return res;
  }

  // ACTUAL REQUEST
  const res = NextResponse.next();
  setCorsHeaders(res, origin);
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
