import type { IcpProfileConfig, IcpSection } from "./icp";

/**
 * Configuration completeness, derived only from SAVED configuration.
 * Rules are documented in docs/product/vleeds-icp-configuration.md §4.
 *
 * A section that was never saved is null and therefore "not configured"; an
 * empty object or array never counts as configured, with one deliberate
 * exception: an explicitly saved empty exclusion list means "No exclusions".
 */

export type ConfigState = "not_configured" | "partial" | "configured";

export type SectionStatus = { state: ConfigState; label: string };

const NOT_CONFIGURED: SectionStatus = { state: "not_configured", label: "Not configured" };
const PARTIAL: SectionStatus = { state: "partial", label: "Partially configured" };
const CONFIGURED: SectionStatus = { state: "configured", label: "Configured" };

export function sectionStatus(profile: IcpProfileConfig | null, section: IcpSection): SectionStatus {
  if (!profile) return NOT_CONFIGURED;

  switch (section) {
    case "ideal_customer": {
      const ic = profile.idealCustomer;
      const hasDescription = !!profile.description?.trim();
      const hasCriteria =
        !!ic &&
        (ic.industries.length > 0 ||
          ic.characteristics.length > 0 ||
          ic.keywords.length > 0 ||
          ic.companySize.minEmployees !== null ||
          ic.companySize.maxEmployees !== null);
      if (hasCriteria && hasDescription) return CONFIGURED;
      if (hasCriteria || hasDescription) return PARTIAL;
      return NOT_CONFIGURED;
    }
    case "geographies":
      return profile.geographies && profile.geographies.length > 0 ? CONFIGURED : NOT_CONFIGURED;
    case "decision_makers":
      return profile.decisionMakers && profile.decisionMakers.length > 0 ? CONFIGURED : NOT_CONFIGURED;
    case "buying_signals": {
      const signals = profile.buyingSignals ?? [];
      if (signals.some((s) => s.enabled)) return CONFIGURED;
      return signals.length > 0 ? PARTIAL : NOT_CONFIGURED;
    }
    case "exclusion_signals": {
      if (profile.exclusionSignals === null) return NOT_CONFIGURED;
      return profile.exclusionSignals.some((s) => s.enabled)
        ? CONFIGURED
        : { state: "configured", label: "No exclusions" };
    }
    case "scoring":
      return profile.scoringModel ? CONFIGURED : NOT_CONFIGURED;
  }
}

export function allSectionStatuses(profile: IcpProfileConfig | null): Record<IcpSection, SectionStatus> {
  return {
    ideal_customer: sectionStatus(profile, "ideal_customer"),
    geographies: sectionStatus(profile, "geographies"),
    decision_makers: sectionStatus(profile, "decision_makers"),
    buying_signals: sectionStatus(profile, "buying_signals"),
    exclusion_signals: sectionStatus(profile, "exclusion_signals"),
    scoring: sectionStatus(profile, "scoring"),
  };
}
