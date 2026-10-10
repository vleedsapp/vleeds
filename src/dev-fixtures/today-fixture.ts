/**
 * DEVELOPMENT-ONLY UI FIXTURE DATA — never imported by production routes.
 *
 * Used solely by src/app/ui-fixtures/today/page.fixture.tsx, a route that
 * exists only in builds made with VLEEDS_UI_FIXTURES=1 (see next.config.ts).
 * Generic, invented example companies; no real businesses, no database rows,
 * no DAL access. Exists to validate the canonical lead-table/drawer design.
 */
import type { LeadDetailView } from "@/components/leads/lead-detail-drawer";
import type { LeadRowView } from "@/components/leads/lead-table";
import type { WorkspaceSummary } from "@/lib/dal";

export const UI_FIXTURE_MARKER = "vleeds-ui-fixture-only";

export const fixtureWorkspace: WorkspaceSummary = {
  id: "f1x70000-0000-4000-a000-000000000001",
  name: "Alpha Workspace",
  slug: "alpha",
  organization: { id: "f1x70000-0000-4000-a000-0000000000aa", name: "Example Org A" },
};

export const fixtureWorkspaces: WorkspaceSummary[] = [
  fixtureWorkspace,
  { id: "f1x70000-0000-4000-a000-000000000002", name: "Beta Workspace", slug: "beta", organization: fixtureWorkspace.organization },
  {
    id: "f1x70000-0000-4000-a000-000000000003",
    name: "Gamma Workspace",
    slug: "gamma",
    organization: { id: "f1x70000-0000-4000-a000-0000000000bb", name: "Example Org B" },
  },
];

export const fixtureUserEmail = "jordan.doe@example.test";

export const fixtureSummary = { leadsReady: 12, callbacksDue: 4, followUps: 2, newDiscoveries: 6 };
export const fixtureCounts = { queue: 18, callbacks: 4, followUps: 2, discoveries: 6 };

export const fixtureRows: LeadRowView[] = [
  { id: "l1", grade: "A", company: "Northwind Freight", location: "Denver, CO", contactName: "Avery Collins", contactTitle: "Owner", fit: 91, signals: [{ label: "Recently hiring", tone: "brand" }, { label: "Growing team", tone: "info" }] },
  { id: "l2", grade: "A", company: "Brightline Services", location: "Austin, TX", contactName: "Maya Torres", contactTitle: "Operations Director", fit: 87, signals: [{ label: "New location", tone: "info" }, { label: "Expanding region", tone: "violet" }] },
  { id: "l3", grade: "A", company: "Cedar & Pine Supply", location: "Portland, OR", contactName: "Ryan Kim", contactTitle: "CEO", fit: 84, signals: [{ label: "Contract win", tone: "brand" }, { label: "Growing team", tone: "info" }] },
  { id: "l4", grade: "B", company: "Harbor Field Group", location: "Charleston, SC", contactName: "Elena Martin", contactTitle: "Operations Manager", fit: 76, signals: [{ label: "Recently hiring", tone: "brand" }, { label: "New location", tone: "info" }] },
  { id: "l5", grade: "B", company: "Summit Ridge Partners", location: "Salt Lake City, UT", contactName: "Daniel Brooks", contactTitle: "Owner", fit: 72, signals: [{ label: "Growing team", tone: "info" }, { label: "New funding", tone: "violet" }] },
  { id: "l6", grade: "B", company: "Oakline Distribution", location: "Columbus, OH", contactName: "Priya Green", contactTitle: "Director", fit: 70, signals: [{ label: "Expanding region", tone: "violet" }, { label: "Recently hiring", tone: "brand" }] },
  { id: "l7", grade: "C", company: "Bluewater Facilities", location: "Tampa, FL", contactName: "Steven Hall", contactTitle: "General Manager", fit: 66, signals: [{ label: "Contract win", tone: "brand" }, { label: "New location", tone: "info" }] },
  { id: "l8", grade: "C", company: "Granite Peak Builders", location: "Boise, ID", contactName: "Nina Carter", contactTitle: "Owner", fit: 64, signals: [{ label: "Growing team", tone: "info" }, { label: "Expanding region", tone: "violet" }] },
];

export function fixtureDetail(id: string): LeadDetailView | null {
  const row = fixtureRows.find((r) => r.id === id);
  if (!row) return null;
  const slug = row.company.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return {
    id: row.id,
    company: row.company,
    subtitle: `${row.location} · Commercial services`,
    grade: row.grade,
    fit: row.fit,
    contact: {
      name: row.contactName,
      role: row.contactTitle,
      phone: "(555) 010-0187",
      email: `${row.contactName.split(" ")[0].toLowerCase()}@${slug}.example`,
      website: `https://${slug}.example`,
    },
    details: { location: row.location, category: "Commercial services", size: "11–50 employees", tags: ["B2B", "Regional", "Owner-led"] },
    signals: row.signals,
    notes: "Opened a second location this quarter. Recently posted several operations roles.",
  };
}
