import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Instant navigation (Cache Components, Next.js 16.4): every workspace page
 * reads the session (createSupabaseServerClient → connection() + cookies()).
 * Navigating between sibling sections keeps the workspace layout and its
 * loading boundary mounted, so a page without its OWN boundary blocks the
 * navigation, and `next dev` reports "Next.js encountered uncached data during
 * prerendering or a navigation". Each page segment therefore needs a
 * loading.tsx (an implicit <Suspense>) next to its page.tsx.
 */
const WORKSPACE = path.resolve(import.meta.dirname, "../../src/app/w/[workspaceId]");

function pageDirs(dir: string): string[] {
  const out = existsSync(path.join(dir, "page.tsx")) ? [dir] : [];
  for (const name of readdirSync(dir)) {
    const child = path.join(dir, name);
    if (statSync(child).isDirectory()) out.push(...pageDirs(child));
  }
  return out;
}

describe("workspace navigation boundaries", () => {
  const dirs = pageDirs(WORKSPACE);

  it("finds the workspace sections", () => {
    const rel = dirs.map((d) => path.relative(WORKSPACE, d) || ".");
    expect(rel).toEqual(expect.arrayContaining([".", "today", "discover", "leads", "campaigns", "settings", "leads/import"]));
  });

  it.each(dirs.map((d) => [path.relative(WORKSPACE, d) || ".", d]))("%s has its own loading.tsx", (_rel, dir) => {
    expect(existsSync(path.join(dir, "loading.tsx"))).toBe(true);
  });
});
