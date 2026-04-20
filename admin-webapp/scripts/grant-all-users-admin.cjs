/**
 * Grant admin dashboard access to every Supabase auth user not yet in public.admin_users.
 * Uses SUPABASE_SERVICE_ROLE_KEY from admin-webapp/.env.local
 *
 * Usage (from repo root):
 *   node admin-webapp/scripts/grant-all-users-admin.cjs
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal(dir) {
  const envPath = path.join(dir, ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing ${envPath}`);
  }
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
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

const adminRoot = path.join(__dirname, "..");
loadEnvLocal(adminRoot);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const perPage = 200;
  let page = 1;
  const all = [];
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    all.push(...data.users);
    if (data.users.length < perPage) break;
    page += 1;
  }

  const { data: existingRows, error: exErr } = await sb
    .from("admin_users")
    .select("id");
  if (exErr) throw exErr;
  const existingIds = new Set((existingRows || []).map((r) => r.id));

  let added = 0;
  for (const u of all) {
    if (!u.email_confirmed_at) continue;
    if (existingIds.has(u.id)) continue;
    const display =
      (typeof u.user_metadata?.pod_username === "string" &&
        u.user_metadata.pod_username.trim()) ||
      u.email ||
      u.id;
    const { error: insErr } = await sb.from("admin_users").insert({
      id: u.id,
      email: display.length > 200 ? display.slice(0, 200) : display,
    });
    if (insErr) {
      console.error("insert failed", u.id, insErr.message);
      continue;
    }
    existingIds.add(u.id);
    added += 1;
    console.log("added:", display);
  }

  console.log(`Done. Added ${added} admin row(s). Total auth users: ${all.length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
