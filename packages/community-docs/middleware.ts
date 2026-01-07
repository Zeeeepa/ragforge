import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

type Role = "READ" | "WRITE" | "ADMIN";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  // Public routes
  const publicRoutes = ["/", "/login", "/api/auth"];
  const isPublicRoute = publicRoutes.some((route) =>
    pathname.startsWith(route)
  );

  // Protected routes that require WRITE role
  const writeRoutes = ["/upload"];
  const isWriteRoute = writeRoutes.some((route) => pathname.startsWith(route));

  // Protected routes that require ADMIN role
  const adminRoutes = ["/admin"];
  const isAdminRoute = adminRoutes.some((route) => pathname.startsWith(route));

  // Allow public routes
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Redirect to login if not authenticated
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Get user role from session
  const userRole = (req.auth?.user as { role?: Role } | undefined)?.role;

  // Check WRITE permission for upload routes
  if (isWriteRoute && userRole === "READ") {
    return NextResponse.redirect(new URL("/search", req.url));
  }

  // Check ADMIN permission for admin routes
  if (isAdminRoute && userRole !== "ADMIN") {
    return NextResponse.redirect(new URL("/search", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
