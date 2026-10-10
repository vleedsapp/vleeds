/**
 * Normalization for lead-core identity. Pure, deterministic and shared by the
 * server (writes, future ingestion) and tests. The database CHECKs the output
 * format; this module is the only place that computes it.
 *
 * Deliberately conservative: when a value cannot be normalized with
 * confidence, the result is null and the original display value is kept.
 */

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * "https://www.Example.com/about?x=1", "http://example.com/", "www.example.com",
 * "example.com." → "example.com". Paths, queries, ports, credentials and a
 * leading "www." never create a different identity. Internationalized names
 * become punycode. Returns null for anything that is not a plausible hostname
 * (IP addresses, single labels, invalid characters).
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  host = host.replace(/^\/\//, "");
  host = host.split(/[/?#\\]/, 1)[0]; // path, query, fragment
  host = host.replace(/^[^@]*@/, ""); // credentials
  host = host.replace(/:\d*$/, ""); // port
  host = host.replace(/\.+$/, ""); // trailing dot(s)
  if (!host || /\s/.test(host)) return null;
  try {
    host = new URL(`http://${host}`).hostname; // IDN → punycode, validates characters
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  if (host.length > 253 || host.split(".").some((label) => label.length === 0 || label.length > 63)) return null;
  if (!DOMAIN_RE.test(host)) return null;
  if (/^[0-9.]+$/.test(host)) return null; // IPv4
  if (/^[0-9-]+$/.test(host.split(".").pop()!)) return null; // numeric TLD
  return host;
}

/**
 * Comparison form of a company name. Keeps every word (legal suffixes such as
 * "Ltd" or "Group" can be meaningful) and only removes formatting noise:
 * Unicode compatibility forms, case, repeated whitespace, periods, commas,
 * apostrophes/quotes, "&" vs "and" and dash variants.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[‘’‚‛′'`´"“”]/g, "")
    .replace(/[.,]/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Trim + lower-case. Plus-addressing and dots are kept: their meaning depends on the mail provider. */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const v = email.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}

/**
 * Conservative phone comparison value (E.164-like "+<digits>").
 * Only numbers written in international form ("+…" or "00…") are normalized;
 * national numbers ("(555) 010-0000", "020 7946 0000") return null because
 * their country cannot be known without context. Extensions are dropped from
 * the comparison value. A full phone library can replace this later.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const main = phone.trim().split(/\s*(?:ext\.?|extension|x|#)\s*\d+$/i)[0];
  if (/[^0-9+()\-.\s/]/.test(main)) return null;
  let digits = main.replace(/[^0-9+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+") || digits.indexOf("+", 1) !== -1) return null;
  const national = digits.slice(1);
  return /^[1-9][0-9]{6,14}$/.test(national) ? `+${national}` : null;
}

/** Comparison form of a person's name (same rules as company names, without the "&" rule). */
export function normalizePersonName(name: string): string {
  return name
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[.,'`´’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
