#!/usr/bin/env node
/**
 * Creates (or safely reuses) the local development login, then proves it can
 * sign in with the normal publishable key. LOCAL STACK ONLY.
 *
 *   node --env-file=.env.local scripts/dev/create-local-test-user.mjs
 *
 * Reads (from .env.local, which is git-ignored):
 *   NEXT_PUBLIC_SUPABASE_URL              must be loopback (127.0.0.1 / localhost / ::1)
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  used for the sign-in check only
 *   SUPABASE_SERVICE_ROLE_KEY             local admin credential (`npx supabase status`)
 *   VLEEDS_LOCAL_TEST_EMAIL
 *   VLEEDS_LOCAL_TEST_PASSWORD            at least 12 characters (config.toml)
 *
 * Uses the Auth Admin API (no SQL into auth.*). Public signup stays disabled:
 * admin-created users are not signups. The user is created email-confirmed
 * with no organization or workspace, so they go through normal onboarding.
 * Re-running resets the password to the .env.local value and confirms the
 * email. Never prints keys, passwords or tokens.
 */
import { createClient } from "@supabase/supabase-js";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function fail(message) {
  console.error(`create-local-test-user: ${message}`);
  process.exit(1);
}

const env = (name) => process.env[name]?.trim() || "";
const url = env("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
const email = env("VLEEDS_LOCAL_TEST_EMAIL").toLowerCase();
const password = process.env.VLEEDS_LOCAL_TEST_PASSWORD ?? "";

if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") fail("refusing to run in a production environment.");
let host;
try {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:") fail("NEXT_PUBLIC_SUPABASE_URL must be the local http:// stack.");
  host = parsed.hostname;
} catch {
  fail("NEXT_PUBLIC_SUPABASE_URL is missing or invalid.");
}
if (!LOOPBACK.has(host)) fail(`refusing non-local Supabase host "${host}". This script only targets the local stack.`);
if (!publishableKey) fail("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.");
if (!serviceRoleKey) fail("SUPABASE_SERVICE_ROLE_KEY is not set (local stack: `npx supabase status`).");
if (!email || !email.includes("@")) fail("VLEEDS_LOCAL_TEST_EMAIL is not set.");
if (password.length < 12) fail("VLEEDS_LOCAL_TEST_PASSWORD must be at least 12 characters.");

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceRoleKey, noSession).auth.admin;

async function findUser() {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) fail(`listing users failed (${error.code ?? error.status ?? "unknown"}).`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit || data.users.length < 200) return hit ?? null;
  }
}

const existing = await findUser();
let userId;
if (existing) {
  const { error } = await admin.updateUserById(existing.id, { password, email_confirm: true });
  if (error) fail(`updating the existing user failed (${error.code ?? error.status ?? "unknown"}: ${error.message}).`);
  userId = existing.id;
  console.log(`Reused existing local user ${email} (${userId}); password synced, email confirmed.`);
} else {
  const { data, error } = await admin.createUser({ email, password, email_confirm: true });
  if (error) fail(`creating the user failed (${error.code ?? error.status ?? "unknown"}: ${error.message}).`);
  userId = data.user.id;
  console.log(`Created local user ${email} (${userId}), email confirmed.`);
}

// Sign-in check with the browser-safe key, exactly like the app.
const { data: signIn, error: signInError } = await createClient(url, publishableKey, noSession).auth.signInWithPassword({ email, password });
if (signInError) fail(`password sign-in failed (${signInError.code ?? signInError.status ?? "unknown"}: ${signInError.message}).`);
if (!signIn.session?.access_token) fail("password sign-in returned no session.");
if (signIn.user.id !== userId) fail("password sign-in returned a different user id.");
console.log(`Password sign-in OK with the publishable key: session issued, user id matches.`);
