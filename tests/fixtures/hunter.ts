/**
 * FICTIONAL Hunter API v2 responses for unit tests (shapes per Hunter's
 * documentation; every name, domain, phone and id is invented). Fields Vleeds
 * must ignore (emails, social handles, funding, tech, metrics it doesn't use)
 * are included on purpose so tests can prove they are dropped.
 */

export const DOMAIN_FINDER_OK = {
  data: [
    { domain: "quillstone.example.test", company_name: "Quillstone Ledger", logo: "https://logos.example.test/q.png", email_count: 12 },
    { domain: "WWW.Quillstone-Group.example.test", company_name: "Quillstone Group", logo: null, email_count: 3 },
    { domain: "quillstone.example.test", company_name: "Quillstone Ledger (dup)", logo: null, email_count: 1 },
    { domain: "not a domain", company_name: "Broken", logo: null, email_count: 0 },
  ],
  meta: { results: 4, params: { company: "Quillstone Ledger", limit: 5, perfect_match: false } },
};

export const DOMAIN_FINDER_EMPTY = { data: [], meta: { results: 0 } };

export const COMPANY_OK = {
  data: {
    id: "hc-000123",
    name: "Quillstone Ledger",
    legalName: "Quillstone Ledger Ltd",
    domain: "quillstone.example.test",
    domainAliases: ["quillstone-ledger.example.test"],
    site: { phoneNumbers: ["+44 20 7946 0999"], emailAddresses: ["owner@quillstone.example.test", "jo.private@quillstone.example.test"] },
    category: { sector: "Industrials", industryGroup: "Commercial Services", industry: "Bookkeeping Services", subIndustry: "Payroll", sicCode: "8721" },
    tags: ["Bookkeeping", "Payroll", "bookkeeping", "Small business"],
    description: "  Quillstone Ledger provides   bookkeeping and payroll services for small firms.  ",
    foundedYear: 2011,
    location: "1 Fictional Way, Sample Town, GB",
    timeZone: "Europe/London",
    geo: {
      streetNumber: "1",
      streetName: "Fictional Way",
      streetAddress: "1 Fictional Way",
      city: "Sample Town",
      postalCode: "ZZ1 1ZZ",
      state: "Sample County",
      stateCode: "SC",
      country: "United Kingdom",
      countryCode: "GB",
      lat: 51.0,
      lng: -0.1,
    },
    logo: "https://logos.example.test/q.png",
    facebook: { handle: "quillstone-fb" },
    linkedin: { handle: "company/quillstone" },
    twitter: { handle: "quillstone", followers: 1234 },
    type: "private",
    phone: null,
    metrics: { alexaGlobalRank: 99999, trafficRank: "low", employees: "11-50", marketCap: null, raised: 250000, annualRevenue: null, estimatedAnnualRevenue: "$1M-$10M" },
    tech: ["example-cms", "example-analytics"],
    fundingRounds: [{ amount: 250000 }],
    emailProvider: "example-mail",
  },
  meta: { domain: "quillstone.example.test" },
};

export const COMPANY_MINIMAL = { data: { domain: "bare.example.test" }, meta: { domain: "bare.example.test" } };
