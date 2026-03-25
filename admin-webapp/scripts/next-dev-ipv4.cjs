/* Prefer IPv4 when resolving hostnames — helps on some Windows / dual-stack networks where IPv6 to Supabase fails. */
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"]
  .filter(Boolean)
  .join(" ");

const { spawnSync } = require("node:child_process");
const r = spawnSync("npx", ["next", "dev"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});
process.exit(r.status ?? 1);
