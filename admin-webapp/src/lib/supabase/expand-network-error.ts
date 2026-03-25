/**
 * Supabase JS 在底层 fetch 失败时常返回 error.message === "fetch failed"（不抛异常），
 * 需要单独展开说明，否则用户只看到一句英文。
 */
export function expandSupabaseNetworkMessage(context: string, message: string): string {
  const m = message.trim();
  if (/^fetch failed$/i.test(m)) {
    return [
      `无法连接 Supabase（${context}）。`,
      `含义：Next 服务端用 Node 的 fetch 访问你的项目 URL 时，TCP/TLS 没成功（与网页是否部署无关）。`,
      `常见原因：公司网/防火墙拦截、代理或 VPN 未正确作用于 Node、杀软 HTTPS 扫描、DNS/IPv6 异常、部分地区到 *.supabase.co 不稳定。`,
      `建议：换手机热点试；关代理或让终端走系统代理；暂时关杀软 HTTPS 扫描；在浏览器打开 /api/health/supabase 看本机 Node 自检结果。`,
    ].join("");
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|certificate|CERT_|UNABLE_TO_VERIFY/i.test(m)) {
    return `${m}（发生在：${context}）。多为网络或证书问题，同上排查。`;
  }
  return m;
}
