import { Suspense, useState, type ReactNode } from "react";

/** Load a closed panel on demand, then keep its state and closing animation. */
export function DeferredPanel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(active);
  if (active && !mounted) setMounted(true);
  return mounted ? <Suspense fallback={null}>{children}</Suspense> : null;
}
