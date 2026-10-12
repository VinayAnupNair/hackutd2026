import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE = "site_auth";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pages are password-gated; APIs are called after unlock (and by server routes).
  if (
    pathname.startsWith("/password") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  if (request.cookies.get(COOKIE)?.value === "1") {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/password";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
