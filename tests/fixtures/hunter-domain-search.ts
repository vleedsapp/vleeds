/**
 * FICTIONAL Hunter Domain Search responses for unit tests (shape per Hunter's
 * API v2 documentation; every person, email and URL is invented). Fields
 * Vleeds must ignore (twitter, source URLs/pages, organization/pattern data)
 * are included on purpose.
 */

const person = (o: Record<string, unknown>) => ({
  type: "personal",
  confidence: 90,
  seniority: null,
  department: null,
  decision_maker: false,
  linkedin: null,
  twitter: "fictional_handle",
  phone_number: null,
  verification: { date: "2026-09-30", status: "valid" },
  sources: [
    { domain: "pages.example.test", uri: "https://pages.example.test/team", extracted_on: "2026-01-02", last_seen_on: "2026-09-01", still_on_page: true },
    { domain: "pages.example.test", uri: "https://pages.example.test/about", extracted_on: "2026-01-02", last_seen_on: "2026-09-20", still_on_page: true },
  ],
  ...o,
});

export const SEARCH_OK = {
  data: {
    domain: "tidewell.example.test",
    disposable: false,
    webmail: false,
    accept_all: false,
    pattern: "{first}.{last}",
    organization: "Tidewell Fictional Ltd",
    linked_domains: [],
    emails: [
      person({ value: "Ada.Quill@Tidewell.example.test", first_name: "Ada", last_name: "Quill", position: "Head of Operations", seniority: "executive", department: "operations", decision_maker: true, confidence: 94, linkedin: "https://profiles.example.test/ada-quill", phone_number: "+44 20 7946 0111" }),
      person({ value: "ben.ross@tidewell.example.test", first_name: "Ben", last_name: "Ross", position: "Senior Operations Manager", seniority: "senior", department: "operations", verification: { status: "accept_all" }, confidence: 81 }),
      person({ value: "cy.dale@tidewell.example.test", first_name: "Cy", last_name: "Dale", position: "Chief Executive Officer", seniority: "executive", department: "executive", decision_maker: true, verification: { status: "unknown" }, confidence: 120 }),
      person({ value: "no.name@tidewell.example.test", first_name: null, last_name: null, position: "Analyst" }),
      person({ value: "dee.ash@tidewell.example.test", first_name: "Dee", last_name: "Ash", position: "Office Coordinator", seniority: "junior", department: "administrative", linkedin: "profiles.example.test/dee", verification: { status: "weird" } }),
      person({ value: "ada.quill@tidewell.example.test", first_name: "Ada", last_name: "Quill", position: "Duplicate" }),
      { value: "info@tidewell.example.test", type: "generic", confidence: 50 },
    ],
  },
  meta: { results: 7, limit: 10, offset: 0, params: { domain: "tidewell.example.test", type: "personal" } },
};

export const SEARCH_EMPTY = { data: { domain: null, pattern: null, organization: null, emails: [] }, meta: { results: 0 } };
