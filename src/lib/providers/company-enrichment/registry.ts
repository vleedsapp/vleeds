import "server-only";

import { loopbackEndpointOverride } from "../endpoint-override";
import { createHunterProvider } from "./hunter/adapter";
import { HUNTER_PROVIDER_KEY } from "./hunter/usage";
import type { CompanyEnrichmentProvider } from "./types";

/**
 * Server-only registry of company-enrichment providers. Pages, actions and the
 * DAL ask for a provider by key and use the generic interface only.
 *
 * Configuration is environment-based for P1-E4:
 *   HUNTER_API_KEY        server-only; never NEXT_PUBLIC_, never logged.
 *   HUNTER_API_ENDPOINT   DEVELOPMENT/REVIEW ONLY: base URL (…/v2) of a local
 *                         mock. Accepted only for loopback hosts and never on a
 *                         Vercel production deployment.
 */

export const DEFAULT_ENRICHMENT_PROVIDER = HUNTER_PROVIDER_KEY;

type Env = Record<string, string | undefined>;

export function createEnrichmentProviders(env: Env): Map<string, CompanyEnrichmentProvider> {
  const apiKey = env.HUNTER_API_KEY?.trim() || null;
  const hunter = createHunterProvider({ apiKey, baseUrl: loopbackEndpointOverride(env.HUNTER_API_ENDPOINT, env) });
  return new Map([[hunter.providerKey, hunter]]);
}

/** Looks up a provider by key (null for unknown keys). Reads the environment on each call. */
export function getEnrichmentProvider(key: string = DEFAULT_ENRICHMENT_PROVIDER): CompanyEnrichmentProvider | null {
  return createEnrichmentProviders(process.env).get(key) ?? null;
}
