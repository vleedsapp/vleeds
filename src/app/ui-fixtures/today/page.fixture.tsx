/**
 * DEVELOPMENT-ONLY ROUTE: /ui-fixtures/today
 *
 * The `.fixture.tsx` extension is only registered as a page extension when the
 * build runs with VLEEDS_UI_FIXTURES=1 (next.config.ts). Normal and production
 * builds do not contain this route or its fixture data at all; this is
 * verified by scripts/check-client-bundle.mjs.
 */
import type { Metadata } from "next";
import { FixtureToday } from "./fixture-today";

export const metadata: Metadata = { title: "UI fixture · Today" };

export default function FixtureTodayPage() {
  return <FixtureToday />;
}
