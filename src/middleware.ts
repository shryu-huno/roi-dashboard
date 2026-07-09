import { NextResponse, type NextRequest } from "next/server";

// Auth.js v5 기본 세션 쿠키명 (https 배포 시 __Secure- 접두사)
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/pending") ||
    pathname.startsWith("/api/auth");
  const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));
  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
