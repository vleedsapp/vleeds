"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Keeps workflow sheets (Start contact, task actions) mounted above the rows
 * that open them. Saving refreshes Today, and the row that opened a sheet may
 * disappear (the contact is no longer Ready, the task is no longer due); the
 * sheet must stay to show its confirmation. Without a host, sheets mount
 * next to their button as before.
 */

type Render = (close: () => void) => ReactNode;
const HostContext = createContext<((render: Render) => void) | null>(null);

export function WorkflowSheetHost({ children }: { children: ReactNode }) {
  const [render, setRender] = useState<Render | null>(null);
  const close = useCallback(() => setRender(null), []);
  const open = useCallback((r: Render) => setRender(() => r), []);
  return (
    <HostContext.Provider value={open}>
      {children}
      {render ? render(close) : null}
    </HostContext.Provider>
  );
}

/** `open(render)` shows a sheet in the nearest host (or locally); render `element` next to the trigger. */
export function useWorkflowSheet(): { open: (render: Render) => void; element: ReactNode } {
  const host = useContext(HostContext);
  const [local, setLocal] = useState<Render | null>(null);
  const close = useCallback(() => setLocal(null), []);
  return useMemo(
    () => ({
      open: (r: Render) => (host ? host(r) : setLocal(() => r)),
      element: !host && local ? local(close) : null,
    }),
    [host, local, close],
  );
}
