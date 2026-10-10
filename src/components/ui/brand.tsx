import { cx } from "./primitives";

/** The Vleeds "V" mark: two angled strokes, deep green with a lighter inner stroke. */
export function VleedsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 26" aria-hidden className={cx("h-[26px] w-8 shrink-0", className)}>
      <path d="M0.5 1.5h7.4l8.1 15.3-3.8 7.7z" fill="var(--color-brand)" />
      <path d="M31.5 1.5h-7.6l-11.7 23h3.6c1.2 0 2.2-.6 2.7-1.7z" fill="var(--color-brand)" />
      <path d="M23.9 1.5h3.4L16 23.6l-1.8-3.4z" fill="#3f8b6b" opacity="0.55" />
    </svg>
  );
}

/** Mark + spaced uppercase wordmark, as in the canonical shell. */
export function VleedsLogo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cx("inline-flex items-center text-ink", compact ? "gap-2" : "gap-2.5", className)}>
      <VleedsMark className={compact ? "h-[19px] w-6" : undefined} />
      <span
        className={cx(
          "font-semibold uppercase leading-none",
          compact ? "text-[14.5px] tracking-[0.13em]" : "text-[20px] tracking-[0.16em]",
        )}
      >
        Vleeds
      </span>
    </span>
  );
}
