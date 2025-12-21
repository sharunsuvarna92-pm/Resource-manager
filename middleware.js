import { NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://resource-manager-zeta.vercel.app",
];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

export function middleware(request) {
  const origin = request.headers.get("origin");
  const pathname = request.nextUrl.pathname;

  if (!pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  // Preflight
  if (request.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    Object.entries(corsHeaders(allowedOrigin)).forEach(([k, v]) =>
      res.headers.set(k, v)
    );
    return res;
  }

  // Normal request
  const res = NextResponse.next();
  Object.entries(corsHeaders(allowedOrigin)).forEach(([k, v]) =>
    res.headers.set(k, v)
  );

  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
