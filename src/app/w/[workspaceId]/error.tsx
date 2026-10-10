"use client";

import { ErrorPanel } from "@/components/shell/status-panels";

export default function WorkspaceError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel {...props} />;
}
