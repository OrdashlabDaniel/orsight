import nodemailer from "nodemailer";

type ShareMailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

type ShareInviteMailInput = {
  to: string;
  inviterEmail: string;
  formName: string;
  acceptUrl: string;
  expiresAt: number;
};

let cachedTransport: nodemailer.Transporter | null = null;
let cachedConfigKey = "";

function envValue(...keys: string[]) {
  for (const key of keys) {
    const value = (process.env[key] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function getShareMailConfig(): ShareMailConfig | null {
  const host = envValue("FORM_SHARE_SMTP_HOST", "SMTP_HOST");
  const portRaw = envValue("FORM_SHARE_SMTP_PORT", "SMTP_PORT");
  const user = envValue("FORM_SHARE_SMTP_USER", "SMTP_USER");
  const pass = envValue("FORM_SHARE_SMTP_PASS", "SMTP_PASS");
  const from = envValue("FORM_SHARE_FROM_EMAIL", "SMTP_FROM_EMAIL", "MAIL_FROM");
  const secureRaw = envValue("FORM_SHARE_SMTP_SECURE", "SMTP_SECURE").toLowerCase();
  const port = Number(portRaw || "587");
  if (!host || !user || !pass || !from || !Number.isFinite(port) || port <= 0) {
    return null;
  }
  return {
    host,
    port,
    user,
    pass,
    from,
    secure: secureRaw ? ["1", "true", "yes", "on"].includes(secureRaw) : port === 465,
  };
}

export function isFormShareEmailConfigured() {
  return Boolean(getShareMailConfig());
}

function getTransport(config: ShareMailConfig) {
  const key = `${config.host}:${config.port}:${config.user}:${config.from}:${config.secure ? "1" : "0"}`;
  if (!cachedTransport || cachedConfigKey !== key) {
    cachedTransport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
    cachedConfigKey = key;
  }
  return cachedTransport;
}

export async function sendFormShareInviteEmail(input: ShareInviteMailInput) {
  const config = getShareMailConfig();
  if (!config) {
    return { sent: false as const, reason: "unconfigured" as const };
  }

  const subject = `OrSight form share: ${input.formName}`;
  const expiresAtText = new Date(input.expiresAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const text = [
    `${input.inviterEmail} shared an OrSight form with you.`,
    "",
    `Form: ${input.formName}`,
    `Open: ${input.acceptUrl}`,
    `Expires: ${expiresAtText}`,
    "",
    "Sign in to OrSight with the invited email address, then accept the shared form.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
      <p><strong>${escapeHtml(input.inviterEmail)}</strong> shared an OrSight form with you.</p>
      <p><strong>Form:</strong> ${escapeHtml(input.formName)}<br /><strong>Expires:</strong> ${escapeHtml(expiresAtText)}</p>
      <p><a href="${escapeHtml(input.acceptUrl)}" style="display:inline-block;padding:10px 16px;background:#0f172a;color:#fff;text-decoration:none;border-radius:10px;">Open shared form</a></p>
      <p>If the button does not work, copy this link into your browser:</p>
      <p><a href="${escapeHtml(input.acceptUrl)}">${escapeHtml(input.acceptUrl)}</a></p>
      <p>Sign in to OrSight with the invited email address, then accept the shared form.</p>
    </div>
  `;

  await getTransport(config).sendMail({
    from: config.from,
    to: input.to,
    subject,
    text,
    html,
  });
  return { sent: true as const };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
