"use client";

import "./globals.css";
import { ErrorPanel } from "@/components/shell/status-panels";

export default function GlobalError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="min-h-dvh px-4">
          <ErrorPanel {...props} />
        </main>
      </body>
    </html>
  );
}
