export async function usernameToPodLoginEmail(username: string): Promise<string> {
  const normalized = username.trim();
  if (!normalized) {
    throw new Error("用户名不能为空");
  }

  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = new Uint8Array(digest);
  let binary = "";
  for (let i = 0; i < hashArray.length; i += 1) {
    binary += String.fromCharCode(hashArray[i]!);
  }
  const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64.toLowerCase()}@pod-login.local`;
}

export async function usernameToPodLoginEmailLegacy(username: string): Promise<string> {
  const normalized = username.trim();
  if (!normalized) {
    throw new Error("用户名不能为空");
  }

  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = new Uint8Array(digest);
  let binary = "";
  for (let i = 0; i < hashArray.length; i += 1) {
    binary += String.fromCharCode(hashArray[i]!);
  }
  const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64}@pod-login.local`;
}
