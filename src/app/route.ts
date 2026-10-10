import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/dal";
import { resolveHomePath } from "@/lib/home";
import { LAST_WORKSPACE_COOKIE } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Entry point for direct visits to "/". Real HTTP redirect to the user's home
 * workspace. Client-side code links here with a plain <a> (full navigation),
 * since the client router does not follow route-handler redirects.
 */
export async function GET(request: NextRequest) {
  await requireUser();
  const path = await resolveHomePath(
    await createSupabaseServerClient(),
    request.cookies.get(LAST_WORKSPACE_COOKIE)?.value,
  );
  return NextResponse.redirect(new URL(path, request.url));
}
