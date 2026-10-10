import type { ReactNode } from "react";
import { cx, Panel } from "./primitives";

/**
 * Canonical empty-state illustration: a soft green halo and low hills, with
 * either the inbox tray (Today) or a white tile holding a section icon.
 * Decorative only (aria-hidden); meaning is always carried by the text.
 */
export function EmptyIllustration({ icon, className }: { icon?: ReactNode; className?: string }) {
  return (
    <div aria-hidden className={cx("relative mx-auto h-[132px] w-[240px]", className)}>
      {/* Edge fade (as in the canonical illustration) via mask, not a colored gradient. */}
      <svg
        viewBox="0 0 240 132"
        className="absolute inset-0 size-full [mask-image:linear-gradient(to_right,transparent,#000_22%,#000_78%,transparent)]"
      >
        <circle cx="120" cy="70" r="58" fill="var(--color-brand-tint)" opacity="0.75" />
        <path d="M0 112c26-18 50-26 76-22 22 3 34 14 54 14H0z" fill="var(--color-brand-tint-strong)" opacity="0.55" />
        <path d="M120 104c22-2 34-26 62-30 24-3 42 10 58 22v8z" fill="var(--color-brand-tint-strong)" opacity="0.7" />
        {icon ? null : (
          <g>
            <g stroke="var(--color-brand)" strokeWidth="3" strokeLinecap="round">
              <path d="M104 16l5 8" />
              <path d="M120 10v10" />
              <path d="M136 16l-5 8" />
            </g>
            <rect x="96" y="34" width="48" height="50" rx="7" fill="#fff" stroke="var(--color-line)" />
            <path d="M107 50h26M107 59h26" stroke="var(--color-line-strong)" strokeWidth="3" strokeLinecap="round" />
            <path
              d="M80 70h20l6 10h28l6-10h20v28a8 8 0 0 1-8 8H88a8 8 0 0 1-8-8z"
              fill="#fff"
              stroke="var(--color-line)"
            />
          </g>
        )}
      </svg>
      {icon ? (
        <div className="absolute left-1/2 top-[34px] grid size-[60px] -translate-x-1/2 place-items-center rounded-[14px] border border-line bg-surface text-brand shadow-card [&_svg]:size-7 [&_svg]:stroke-[1.6]">
          {icon}
        </div>
      ) : null}
    </div>
  );
}

/** Premium empty state inside a panel. Text is always truthful about why data is absent. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  bare,
  className,
}: {
  /** Section icon; omit for the Today inbox illustration. */
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Render without the surrounding panel (when already inside one). */
  bare?: boolean;
  className?: string;
}) {
  const body = (
    <div className={cx("flex flex-col items-center px-6 py-10 text-center sm:py-12", className)}>
      <EmptyIllustration icon={icon} />
      <h2 className="mt-5 text-[19px] font-semibold tracking-[-0.01em] text-ink sm:text-[21px]">{title}</h2>
      {children ? <div className="mt-2 max-w-md text-[15px] leading-6 text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
  return bare ? body : <Panel>{body}</Panel>;
}
