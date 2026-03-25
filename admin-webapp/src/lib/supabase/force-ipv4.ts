/**
 * Prefer IPv4 when resolving hostnames (Windows / 双栈网络下常见 Supabase `fetch failed`).
 * 仅在 Node 服务端加载（server.ts / service.ts）；勿在 Edge middleware 中引用。
 */
import dns from "node:dns";

if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}
