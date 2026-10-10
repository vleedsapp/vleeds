import { describe, expect, it } from "vitest";
import { looksLikeSecretKey, parsePublicEnv } from "@/lib/env";
import { initialsFromEmail } from "@/lib/format";
import { isUuid, safeNextPath, sectionFromPath, workspacePath } from "@/lib/navigation";
import { isValidSlug, slugify } from "@/lib/slug";

const jwt = (payload: object) =>
  ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

describe("public env", () => {
  const url = "http://127.0.0.1:54321";

  it("accepts a publishable key", () => {
    expect(() =>
      parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnop" }),
    ).not.toThrow();
    expect(() =>
      parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon" }) }),
    ).not.toThrow();
  });

  it("refuses to start if a secret/service-role key is placed in the public variable", () => {
    for (const key of ["sb_secret_abcdefghijklmnopqrstuv", jwt({ role: "service_role" })]) {
      expect(looksLikeSecretKey(key)).toBe(true);
      expect(() => parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key })).toThrow(
        /not a secret/,
      );
    }
  });

  it("reports missing configuration clearly", () => {
    expect(() => parsePublicEnv({})).toThrow(/Invalid Vleeds configuration/);
  });
});

describe("navigation", () => {
  const id = "20000000-0000-4000-a000-00000000000a";

  it("builds workspace-scoped paths", () => {
    expect(workspacePath(id)).toBe(`/w/${id}/today`);
    expect(workspacePath(id, "leads")).toBe(`/w/${id}/leads`);
  });

  it("preserves the section when switching workspaces", () => {
    expect(sectionFromPath(`/w/${id}/campaigns`)).toBe("campaigns");
    expect(sectionFromPath(`/w/${id}/leads/abc`)).toBe("leads");
    expect(sectionFromPath(`/w/${id}/unknown`)).toBe("today");
  });

  it("validates UUIDs", () => {
    expect(isUuid(id)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(`${id}' or 1=1`)).toBe(false);
  });

  it("only allows same-origin relative post-login redirects", () => {
    expect(safeNextPath("/w/x/leads")).toBe("/w/x/leads");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });
});

describe("avatar initials", () => {
  it("derives two-letter initials from an email", () => {
    expect(initialsFromEmail("jordan.doe@example.test")).toBe("JD");
    expect(initialsFromEmail("owner.a@example.test")).toBe("OA");
    expect(initialsFromEmail("multi@example.test")).toBe("MU");
    expect(initialsFromEmail(null)).toBe("?");
  });
});

describe("slugs", () => {
  it("matches the database slug constraint", () => {
    expect(slugify("Acme Widgets, Inc.")).toBe("acme-widgets-inc");
    expect(slugify("  Café Ünïcode  ")).toBe("cafe-unicode");
    expect(isValidSlug(slugify("Acme Widgets"))).toBe(true);
    expect(isValidSlug(slugify("!"))).toBe(false);
    expect(isValidSlug("Bad Slug")).toBe(false);
    expect(slugify("x".repeat(100))).toHaveLength(64);
  });
});
