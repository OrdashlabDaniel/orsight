"use client";

import { useEffect } from "react";

export default function HostNormalizer() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const { hostname, pathname, search, hash, protocol } = window.location;
    const isLoopbackIp =
      hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";

    if (!isLoopbackIp) return;

    const nextUrl = `${protocol}//localhost:3101${pathname}${search}${hash}`;
    window.location.replace(nextUrl);
  }, []);

  return null;
}
