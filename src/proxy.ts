import { NextResponse, type NextRequest } from "next/server";
import { isUuid, LAST_WORKSPACE_COOKIE } from "@/lib/navigation";
import { updateSession, withSessionCookies } from "@/lib/supabase/proxy";

/**
 * Runs before every page request:
 *  - refreshes the Supabase session cookie,
 *  - redirects unauthenticated users to /login (optimistic UX check only —
 *    the Data Access Layer and RLS remain the actual authorization),
 *  - remembers the last opened workspace as a non-authoritative hint.
 */
const PUBLIC_PATHS = new Set(["/login"]);

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (!user && !PUBLIC_PATHS.has(pathname)) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return withSessionCookies(NextResponse.redirect(login), response);
  }

  if (user && pathname === "/login") {
    return withSessionCookies(NextResponse.redirect(new URL("/", request.url)), response);
  }

  const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1];
  if (user && isUuid(workspaceId)) {
    response.cookies.set(LAST_WORKSPACE_COOKIE, workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimization.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
