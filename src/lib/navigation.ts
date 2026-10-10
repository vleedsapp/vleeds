/**
 * Primary navigation. Every section is workspace-scoped: URLs are always
 * /w/{workspaceId}/{section}, so the active workspace is explicit and is
 * re-authorized by RLS on every request.
 */
export const SECTIONS = [
  { slug: "today", label: "Today" },
  { slug: "discover", label: "Discover" },
  { slug: "leads", label: "Leads" },
  { slug: "campaigns", label: "Campaigns" },
  { slug: "settings", label: "Settings" },
] as const;

export type SectionSlug = (typeof SECTIONS)[number]["slug"];

export const DEFAULT_SECTION: SectionSlug = "today";

export function workspacePath(workspaceId: string, section: SectionSlug = DEFAULT_SECTION): string {
  return `/w/${workspaceId}/${section}`;
}

/** Extracts the section from a pathname like /w/{id}/leads/123 → "leads". */
export function sectionFromPath(pathname: string): SectionSlug {
  const segment = pathname.split("/")[3];
  return SECTIONS.find((s) => s.slug === segment)?.slug ?? DEFAULT_SECTION;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return !!value && UUID.test(value);
}

/** Cookie remembering the last opened workspace. A hint only — always re-validated via RLS. */
export const LAST_WORKSPACE_COOKIE = "vleeds_last_workspace";

/** Only allow same-origin relative redirects after sign-in. */
export function safeNextPath(next: string | undefined | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
