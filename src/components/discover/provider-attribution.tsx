import type { ResultAttribution } from "@/lib/providers/company-discovery/types";

/**
 * Provider attribution shown with provider-derived results only. For Google
 * Maps Platform content displayed without a map, the text "Google Maps" is
 * used unmodified: not translated (translate="no"), not wrapped, sans-serif
 * 400 weight, #5E5E5E at 12–16px (Google's text-attribution rules). It is
 * styled as attribution, never as a Vleeds status or company field.
 */
export function ProviderAttribution({ text, extra = [] }: { text: string; extra?: ResultAttribution[] }) {
  const providers = [...new Map(extra.map((a) => [a.provider, a])).values()];
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-ink-subtle">
      <span className="sr-only">Results data: </span>
      <span
        translate="no"
        aria-label={text}
        className="whitespace-nowrap font-sans text-[13px] font-normal not-italic tracking-normal"
        style={{ color: "#5E5E5E" }}
      >
        {text}
      </span>
      {providers.map((a) =>
        a.uri ? (
          <a key={a.provider} href={a.uri} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
            {a.provider}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <span key={a.provider}>{a.provider}</span>
        ),
      )}
    </p>
  );
}
