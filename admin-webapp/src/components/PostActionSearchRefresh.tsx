"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Server actions redirect back with ?notice= / ?err= / ?_r=…
 * `router.refresh()` can still reuse a stale RSC payload on the same route.
 * One hard reload guarantees the HTML matches the database (recycle list + banner).
 */
function PostActionSearchRefreshInner() {
  const searchParams = useSearchParams();
  const notice = searchParams.get("notice");
  const err = searchParams.get("err");
  const bump = searchParams.get("_r");

  useEffect(() => {
    if (!notice && !err) {
      return;
    }

    const href = typeof window !== "undefined" ? window.location.href : "";
    const key = `orsight_hard_reload:${href}`;

    const id = window.setTimeout(() => {
      try {
        if (sessionStorage.getItem(key)) {
          return;
        }
        sessionStorage.setItem(key, "1");
      } catch {
        // sessionStorage may be unavailable; still reload once.
      }
      window.location.reload();
    }, 120);

    return () => window.clearTimeout(id);
  }, [notice, err, bump]);

  return null;
}

export function PostActionSearchRefresh() {
  return (
    <Suspense fallback={null}>
      <PostActionSearchRefreshInner />
    </Suspense>
  );
}
