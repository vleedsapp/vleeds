import "server-only";

import { loopbackEndpointOverride } from "../endpoint-override";
import { createHunterContactProvider } from "./hunter/adapter";
import { HUNTER_PROVIDER_KEY } from "./hunter/usage";
import type { ContactDiscoveryProvider } from "./types";

/**
 * Server-only registry of contact-discovery providers. Uses the same server
 * environment as the Hunter enrichment provider (P1-E4):
 *   HUNTER_API_KEY        server-only; never NEXT_PUBLIC_, never logged.
 *   HUNTER_API_ENDPOINT   DEVELOPMENT/REVIEW ONLY (loopback, not in production).
 */

export const DEFAULT_CONTACT_PROVIDER = HUNTER_PROVIDER_KEY;

type Env = Record<string, string | undefined>;

export function createContactProviders(env: Env): Map<string, ContactDiscoveryProvider> {
  const apiKey = env.HUNTER_API_KEY?.trim() || null;
  const hunter = createHunterContactProvider({ apiKey, baseUrl: loopbackEndpointOverride(env.HUNTER_API_ENDPOINT, env) });
  return new Map([[hunter.providerKey, hunter]]);
}

export function getContactProvider(key: string = DEFAULT_CONTACT_PROVIDER): ContactDiscoveryProvider | null {
  return createContactProviders(process.env).get(key) ?? null;
}
