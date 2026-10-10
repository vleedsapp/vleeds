import { SearchX } from "lucide-react";
import { VleedsLogo } from "@/components/ui/brand";
import { buttonClass, IconCircle } from "@/components/ui/primitives";

/**
 * Shown for unknown routes AND for workspaces the user cannot access.
 * The message is intentionally identical so workspace ids cannot be probed.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <VleedsLogo />
      <div className="mt-8 w-full max-w-[420px] rounded-2xl border border-line bg-surface p-6 text-center shadow-card sm:p-8">
        <IconCircle tone="neutral" size="lg" className="mx-auto">
          <SearchX className="stroke-[1.75]" />
        </IconCircle>
        <h1 className="mt-4 text-[21px] font-semibold tracking-[-0.01em] text-ink">Not available</h1>
        <p className="mt-2 text-[15px] leading-6 text-ink-muted">
          This page doesn&apos;t exist, or it belongs to a workspace you don&apos;t have access to.
        </p>
        {/* Plain <a>: "/" is a route handler that redirects, which needs a full navigation. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- "/" is a route handler, not a page */}
        <a href="/" className={buttonClass("primary", "mt-6 w-full", "lg")}>
          Go to my workspaces
        </a>
      </div>
    </main>
  );
}
