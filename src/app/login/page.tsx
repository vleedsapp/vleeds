import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { VleedsLogo } from "@/components/ui/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        <div className="flex justify-center">
          <VleedsLogo />
        </div>
        <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">Sign in</h1>
          <p className="mt-1.5 text-[15px] text-ink-muted">Welcome back. Sign in to your workspace.</p>
          <div className="mt-6">
            <Suspense fallback={<div className="skeleton h-[236px] w-full" />}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-[13px] text-ink-subtle">
          <Lock aria-hidden className="size-3.5" />
          Access is by invitation from your organization.
        </p>
      </div>
    </main>
  );
}
