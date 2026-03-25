import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Next/dotenv 默认**不会**覆盖已在进程里的环境变量。若终端或 IDE 注入了
 * NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co，会盖过 .env.local。
 * 这里在读取配置时强制用 .env.local 中的 Supabase 三项覆盖，避免本地永远连假域名。
 */
function forceSupabaseEnvFromEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  const keysToOverride = new Set([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    if (!keysToOverride.has(key)) continue;
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

forceSupabaseEnvFromEnvLocal();

const nextConfig: NextConfig = {};

export default nextConfig;
