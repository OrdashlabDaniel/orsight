import { NextResponse } from "next/server";

import { assertRealSupabaseProjectUrl, normalizeSupabaseUrl } from "@/lib/supabase/env";
import "@/lib/supabase/force-ipv4";

export const runtime = "nodejs";

/**
 * 从「跑 Next 的同一 Node 进程」访问 Supabase，用于区分：
 * - 浏览器能上网 ≠ Node 能连 Supabase
 */
export async function GET() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url) {
    return NextResponse.json(
      { ok: false, step: "env", error: "缺少 NEXT_PUBLIC_SUPABASE_URL" },
      { status: 500 },
    );
  }

  try {
    assertRealSupabaseProjectUrl(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        step: "env_placeholder",
        error: msg,
        requestedUrl: `${url}/auth/v1/health`,
        meaning:
          "当前 URL 不是真实 Supabase 项目地址，DNS 会报 ENOTFOUND。与防火墙无关，请改 .env.local 后重启。",
      },
      { status: 400 },
    );
  }

  const target = `${url}/auth/v1/health`;
  const t0 = Date.now();

  try {
    const res = await fetch(target, {
      headers: anon
        ? { apikey: anon, Authorization: `Bearer ${anon}` }
        : {},
      cache: "no-store",
    });
    const ms = Date.now() - t0;

    return NextResponse.json({
      ok: true,
      httpStatus: res.status,
      latencyMs: ms,
      requestedUrl: target,
      meaning:
        res.status === 401
          ? "已连通：401 在此接口上很常见，说明 TLS 与路由正常。"
          : `已收到 HTTP ${res.status}。`,
    });
  } catch (e) {
    const ms = Date.now() - t0;
    const err = e instanceof Error ? e.message : String(e);
    const cause =
      e instanceof Error && e.cause instanceof Error ? e.cause.message : null;

    return NextResponse.json(
      {
        ok: false,
        latencyMs: ms,
        requestedUrl: target,
        error: err,
        cause,
        meaning:
          "本机 Node 无法完成对该 URL 的请求；注册/登录会在服务端同样失败。请按登录页「fetch failed」说明排查网络/代理/杀软。",
      },
      { status: 503 },
    );
  }
}
