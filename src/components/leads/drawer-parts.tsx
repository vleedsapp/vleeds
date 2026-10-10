import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/primitives";

/** Canonical drawer section: divider, icon + title, indented body. Shared by the lead drawers. */
export function DrawerSection({
  icon: Icon,
  title,
  children,
  last,
  id,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  last?: boolean;
  id?: string;
}) {
  return (
    <section aria-labelledby={id} className={cx("mx-6 border-t border-line py-4", last && "pb-6")}>
      <h3 id={id} className="flex items-center gap-3 text-[15px] font-semibold text-ink">
        <Icon aria-hidden className="size-5 stroke-[1.75] text-ink-muted" />
        {title}
      </h3>
      <div className="mt-3 flex flex-col gap-2.5 pl-8">{children}</div>
    </section>
  );
}

/** Icon + value row inside a drawer section (icon hangs in the section's indent). */
export function DrawerDetail({ icon: Icon, label, children }: { icon: LucideIcon; label?: string; children: ReactNode }) {
  return (
    <div className="-ml-8 flex items-start gap-3 text-[14px] text-ink-muted">
      <Icon aria-hidden className="mt-0.5 size-[18px] shrink-0 stroke-[1.75] text-ink-subtle" />
      <div className="min-w-0 break-words">
        {label ? <span className="sr-only">{label}: </span> : null}
        {children}
      </div>
    </div>
  );
}
