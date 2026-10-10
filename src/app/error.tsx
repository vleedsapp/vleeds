"use client";

import { ErrorPanel } from "@/components/shell/status-panels";

export default function RootError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="min-h-dvh px-4">
      <ErrorPanel {...props} />
    </main>
  );
}
