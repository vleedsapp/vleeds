import { VleedsLogo, VleedsMark } from "@/components/ui/brand";

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="skeleton h-8 w-44" />
      <div className="skeleton mt-3 h-5 w-96 max-w-full" />
      <div className="mt-7 grid grid-cols-4 gap-2.5 sm:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-[104px] rounded-xl sm:h-[150px]" />
        ))}
      </div>
      <div className="skeleton mt-5 h-72 w-full rounded-xl" />
    </div>
  );
}

/** Static frame shown while the session and workspace are verified. */
export function ShellSkeleton() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_minmax(0,1fr)]" aria-busy="true">
      <aside className="hidden h-dvh flex-col gap-6 border-r border-line bg-canvas px-4 pt-6 lg:flex">
        <div className="px-2.5">
          <VleedsLogo />
        </div>
        <div className="skeleton h-[58px] w-full rounded-xl" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton h-10 w-full rounded-lg" />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <div className="hidden h-[72px] items-center border-b border-line/60 bg-surface px-7 lg:flex">
          <div className="skeleton h-11 w-full max-w-[740px] rounded-lg" />
        </div>
        <div className="flex h-16 items-center px-4 lg:hidden">
          <VleedsMark />
        </div>
        <main className="mx-auto w-full max-w-[1440px] px-4 pt-5 sm:px-6 lg:px-7 lg:pt-7">
          <PageSkeleton />
        </main>
      </div>
    </div>
  );
}
