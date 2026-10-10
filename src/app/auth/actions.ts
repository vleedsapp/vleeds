"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { resolveHomePath } from "@/lib/home";
import { LAST_WORKSPACE_COOKIE, safeNextPath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SignInState = { error?: string; email?: string };

const credentials = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(1024),
});

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = credentials.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) {
    return { error: "Enter a valid email address and password.", email };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "invalid_credentials" || error.status === 400) {
      // Deliberately generic: do not reveal whether the account exists.
      return { error: "Incorrect email or password.", email };
    }
    console.error("signIn failed", error.name, error.status, error.code);
    return { error: "Sign-in is unavailable right now. Try again shortly.", email };
  }

  const next = safeNextPath(formData.get("next")?.toString());
  if (next !== "/") redirect(next);

  // Resolve "/" here: the client router cannot follow the "/" route handler's redirect.
  const hint = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  redirect(await resolveHomePath(supabase, hint));
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
