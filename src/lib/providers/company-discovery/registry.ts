import "server-only";

import { loopbackEndpointOverride } from "../endpoint-override";
import { createGooglePlacesProvider } from "./google-places/adapter";
import { GOOGLE_PLACES_PROVIDER_KEY } from "./google-places/fields";
import type { CompanyDiscoveryProvider } from "./types";

/**
 * Server-only registry of company-discovery providers. Pages, actions and the
 * DAL ask for a provider by key and use the generic interface only.
 *
 * Configuration is environment-based for P1-E3:
 *   GOOGLE_PLACES_API_KEY    server-only; never NEXT_PUBLIC_, never logged.
 *   GOOGLE_PLACES_ENDPOINT   DEVELOPMENT/REVIEW ONLY: points the adapter at a
 *                            local mock. Accepted only for loopback hosts and
 *                            never on a Vercel production deployment.
 */

export const DEFAULT_DISCOVERY_PROVIDER = GOOGLE_PLACES_PROVIDER_KEY;

type Env = Record<string, string | undefined>;

/** Returns the override only if it is a loopback http(s) URL outside production deployments. */
export function reviewEndpointOverride(env: Env): string | undefined {
  return loopbackEndpointOverride(env.GOOGLE_PLACES_ENDPOINT, env);
}

export function createDiscoveryProviders(env: Env): Map<string, CompanyDiscoveryProvider> {
  const apiKey = env.GOOGLE_PLACES_API_KEY?.trim() || null;
  const google = createGooglePlacesProvider({ apiKey, endpoint: reviewEndpointOverride(env) });
  return new Map([[google.providerKey, google]]);
}

/** Looks up a provider by key (null for unknown keys). Reads the environment on each call (no restart surprises in dev). */
export function getDiscoveryProvider(key: string = DEFAULT_DISCOVERY_PROVIDER): CompanyDiscoveryProvider | null {
  return createDiscoveryProviders(process.env).get(key) ?? null;
}
