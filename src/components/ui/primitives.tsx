import type { ComponentProps, ReactNode } from "react";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

// -----------------------------------------------------------------------------
// Buttons
// -----------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "soft" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  /** Filled deep green: one primary action per area. */
  primary: "bg-brand text-white hover:bg-brand-hover",
  /** White, fine border: secondary actions (Edit, Filter, Email). */
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-muted",
  /** Green tint: repeated row actions (Call). */
  soft: "bg-brand-tint text-brand-strong hover:bg-brand-tint-strong",
  ghost: "text-ink-muted hover:bg-sunken hover:text-ink",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-3.5 text-[14px]",
  lg: "h-11 px-4 text-[15px]",
};

export function buttonClass(variant: ButtonVariant = "secondary", extra?: string, size: ButtonSize = "md"): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, className, size)} {...props} />;
}

export function IconButton({
  label,
  size = "md",
  className,
  children,
  ...props
}: Omit<ComponentProps<"button">, "size"> & { label: string; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-grid shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-sunken hover:text-ink",
        size === "sm" ? "size-9" : "size-10",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Layout
// -----------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[34px]">{title}</h1>
        {description ? (
          <p className="mt-1.5 text-[15px] leading-6 text-ink-muted sm:text-[17px]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** White rounded panel with a fine border and soft shadow: the base card of the system. */
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cx("rounded-xl border border-line bg-surface shadow-card", className)}
      {...props}
    />
  );
}

/** Card header used by Settings-style cards: tinted icon, title, description, optional action. */
export function PanelHeader({
  icon,
  title,
  description,
  action,
  id,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex items-start gap-4">
      {icon ? <IconCircle tone="brand" size="lg">{icon}</IconCircle> : null}
      <div className="min-w-0 flex-1 pt-0.5">
        <h2 id={id} className="text-[18px] font-semibold leading-6 tracking-[-0.01em] text-ink sm:text-[20px]">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-[14px] leading-5 text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Indicators
// -----------------------------------------------------------------------------

export type Tone = "brand" | "warning" | "info" | "violet" | "danger" | "neutral" | "attention";

const TONE_SURFACE: Record<Tone, string> = {
  brand: "bg-brand-tint text-brand-strong",
  warning: "bg-warning-tint text-warning",
  info: "bg-info-tint text-info",
  violet: "bg-violet-tint text-violet",
  danger: "bg-danger-tint text-danger",
  neutral: "bg-sunken text-ink-muted",
  attention: "bg-attention-tint text-ink",
};

export function toneClass(tone: Tone): string {
  return TONE_SURFACE[tone];
}

/** Tinted circular icon holder (summary cards, card headers, drawer header). */
export function IconCircle({
  tone = "neutral",
  size = "md",
  children,
  className,
}: {
  tone?: Tone;
  size?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
  className?: string;
}) {
  const sizes = { sm: "size-8 [&_svg]:size-4", md: "size-11 [&_svg]:size-5", lg: "size-14 [&_svg]:size-6", xl: "size-16 [&_svg]:size-7" };
  return (
    <span aria-hidden className={cx("grid shrink-0 place-items-center rounded-full", TONE_SURFACE[tone], sizes[size], className)}>
      {children}
    </span>
  );
}

/** Rounded status pill. `dot` adds a leading dot (used for configuration state). */
export function StatusPill({
  tone = "neutral",
  dot,
  children,
  className,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-medium",
        TONE_SURFACE[tone],
        className,
      )}
    >
      {dot ? (
        <span aria-hidden className={cx("size-1.5 rounded-full", tone === "attention" ? "bg-attention" : "bg-current")} />
      ) : null}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-6 min-w-6 place-items-center rounded-sm border border-line bg-surface-muted px-1.5 font-sans text-[11px] font-medium text-ink-subtle">
      {children}
    </kbd>
  );
}

// -----------------------------------------------------------------------------
// Forms
// -----------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  optional,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-baseline justify-between text-[13.5px] font-medium text-ink">
        {label}
        {optional ? <span className="text-[12px] font-normal text-ink-subtle">Optional</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[12.5px] text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "h-11 w-full rounded-md border border-line-strong bg-surface px-3.5 text-[15px] text-ink shadow-[inset_0_1px_1px_rgb(22_25_28/0.03)] placeholder:text-ink-subtle/80 transition-colors hover:border-ink-subtle/50 focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15 aria-invalid:border-danger aria-invalid:focus:ring-danger/15";

export function Alert({ tone = "danger", children }: { tone?: "danger" | "info"; children: ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "rounded-md border px-3.5 py-2.5 text-[13.5px] leading-5",
        tone === "danger" ? "border-danger/20 bg-danger-tint text-danger" : "border-brand/15 bg-brand-tint text-brand-strong",
      )}
    >
      {children}
    </div>
  );
}
