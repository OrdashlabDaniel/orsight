"use server";

import { redirect } from "next/navigation";

import { isFallbackAdminEmail } from "@/lib/admin-access";
import {
  POD_USERNAME_METADATA_KEY,
  usernameToPodLoginEmailLegacySync,
  usernameToPodLoginEmailSync,
} from "@/lib/pod-login-email";
import { expandSupabaseNetworkMessage } from "@/lib/supabase/expand-network-error";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

function errMsg(context: string, raw: string): string {
  return `ERR:${expandSupabaseNetworkMessage(context, raw)}`;
}

function isNextRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function formatSupabaseNetworkError(phase: string, err: unknown): string {
  const tip =
    "这通常表示本机运行 Next 的 Node 进程连不上 Supabase（网络 / DNS / 代理 / IPv6 / 杀软拦截 HTTPS），不是登录按钮本身的逻辑错误。";
  if (err instanceof Error) {
    const cause =
      err.cause instanceof Error
        ? `${err.cause.name}: ${err.cause.message}`
        : err.cause != null
          ? String(err.cause)
          : "";
    return `ERR:${phase}时 ${tip} 原始：${err.message}${cause ? `（${cause}）` : ""}。可试：换网络、关代理；在项目目录执行 npm run dev:ipv4（优先 IPv4）；暂时关闭拦截 HTTPS 的杀毒；确认 .env.local 里的 URL/密钥无多余空格或换行。`;
  }
  return `ERR:${phase}时 ${tip} 原始：${String(err)}。`;
}

function resolveLoginEmailCandidates(identifier: string): { ok: true; emails: string[] } | { ok: false } {
  const value = identifier.trim();
  if (!value) {
    return { ok: false };
  }

  if (value.includes("@")) {
    return { ok: true, emails: [value.toLowerCase()] };
  }

  try {
    const modern = usernameToPodLoginEmailSync(value);
    const legacy = usernameToPodLoginEmailLegacySync(value);
    return { ok: true, emails: Array.from(new Set([modern, legacy])) };
  } catch {
    return { ok: false };
  }
}

/**
 * Single entry for the login form: `intent` = login | register (hidden field).
 * Return `null` = no flash message. `OK:` / `ERR:` prefixes drive client styling.
 */
export async function adminAuth(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const intent = String(formData.get("intent") ?? "login").trim();
  if (intent === "register") {
    return adminRegister(formData);
  }
  return adminSignIn(formData);
}

function resolveSafeNextPath(formData: FormData): string {
  const raw = String(formData.get("next") ?? "").trim();
  if (!raw) return "/viz";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/viz";
  return raw;
}

async function adminSignIn(formData: FormData): Promise<string | null> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = resolveSafeNextPath(formData);

  if (!identifier || !password) {
    return "ERR:请输入登录名和密码。";
  }

  const resolved = resolveLoginEmailCandidates(identifier);
  if (!resolved.ok) {
    return "ERR:登录名无效。";
  }

  try {
    const supabase = await createClient();
    let signInData: { user: { id?: string; email?: string | null } | null } | null = null;
    let lastErrMsg = "";
    let sawSchemaErr = false;

    for (const email of resolved.emails) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!error) {
        signInData = data as { user: { id?: string; email?: string | null } | null };
        break;
      }
      lastErrMsg = error.message;
      if (error.message.toLowerCase().includes("database error querying schema")) {
        sawSchemaErr = true;
      }
      const em = error.message.toLowerCase();
      const isCredentialErr = em.includes("invalid login") || em.includes("invalid email or password");
      if (!isCredentialErr) {
        break;
      }
    }

    if (!signInData) {
      if (sawSchemaErr) {
        return "ERR:登录遇到 Supabase Auth 的 schema 查询异常。系统已自动尝试兼容登录名映射但仍失败；请先检查 Supabase 控制台中的 Auth Hooks / 自定义 JWT Hook 是否引用了不存在的 schema 或表。";
      }
      const em = lastErrMsg.toLowerCase();
      if (em.includes("invalid login") || em.includes("invalid email or password")) {
        if (identifier.includes("@") && isFallbackAdminEmail(identifier)) {
          return "ERR:这个管理员邮箱当前是 Google 登录账号，请点上方“使用 Google 登录”，不要走密码登录。";
        }
        return "ERR:登录名或密码不正确。请确认登录名与注册时完全一致，并且密码正确。";
      }
      return errMsg("登录", lastErrMsg || "未知错误");
    }

    const user = signInData.user;
    if (!user?.id) {
      await supabase.auth.signOut();
      return "ERR:登录未返回用户信息，请重试。";
    }

    let service;
    try {
      service = createServiceRoleClient();
    } catch (e) {
      await supabase.auth.signOut();
      return `ERR:${e instanceof Error ? e.message : "无法校验管理员权限"}`;
    }

    const { data: adminRow, error: adminErr } = await service
      .from("admin_users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (adminErr) {
      await supabase.auth.signOut();
      return errMsg("登录·校验 admin_users", adminErr.message);
    }

    if (isFallbackAdminEmail(user.email)) {
      redirect(nextPath);
    }

    if (!adminRow) {
      await supabase.auth.signOut();
      return "ERR:账号与密码正确，但你的账号当前不在后台管理员名单中，因此无法进入后台。若这是正式权限问题，请把你的用户 ID 写入 public.admin_users。";
    }

    redirect(nextPath);
  } catch (err) {
    if (isNextRedirectError(err)) {
      throw err;
    }
    return formatSupabaseNetworkError("登录", err);
  }
}

async function adminRegister(formData: FormData): Promise<string | null> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = resolveSafeNextPath(formData);

  if (!identifier || !password) {
    return "ERR:请输入登录名和密码。";
  }
  if (password.length < 6) {
    return "ERR:密码至少 6 位。";
  }

  const resolved = resolveLoginEmailCandidates(identifier);
  if (!resolved.ok) {
    return "ERR:登录名无效。";
  }

  let service;
  try {
    service = createServiceRoleClient();
  } catch (e) {
    return `ERR:${e instanceof Error ? e.message : "服务配置错误"}`;
  }

  try {
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: resolved.emails[0]!,
      password,
      email_confirm: true,
      user_metadata: { [POD_USERNAME_METADATA_KEY]: identifier },
    });

    if (createError) {
      return errMsg("注册·创建用户", createError.message);
    }

    const user = created?.user;
    if (!user) {
      return "ERR:创建用户失败，未返回用户信息。";
    }

    const { count, error: countError } = await service
      .from("admin_users")
      .select("*", { count: "exact", head: true });

    if (countError) {
      return errMsg("注册·读取 admin_users", countError.message);
    }

    const adminCount = count ?? 0;

    if (adminCount === 0) {
      const { error: insertError } = await service.from("admin_users").insert({
        id: user.id,
        email: identifier,
      });

      if (insertError) {
        return errMsg("注册·写入首位管理员", insertError.message);
      }

      const supabase = await createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: resolved.emails[0]!,
        password,
      });

      if (signInError) {
        return `${errMsg("注册·自动登录", signInError.message)} 请改用“登录”进入。`;
      }

      redirect(nextPath);
    }

    return "OK:注册成功。当前已存在管理员，你的账号暂时没有后台权限；请让管理员把你的用户 ID 加入 public.admin_users 后再登录。";
  } catch (err) {
    if (isNextRedirectError(err)) {
      throw err;
    }
    return formatSupabaseNetworkError("注册", err);
  }
}
