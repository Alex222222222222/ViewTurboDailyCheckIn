import nodemailer from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password: string;
  from: string;
  to: string;
}

export interface FailureSummary {
  account?: number;
  accountLabel?: string;
  status: string;
  message: string;
}

export interface FailureNotification {
  subject: string;
  text: string;
}

const SMTP_KEYS = [
  "SMTP_HOST", "SMTP_PORT", "SMTP_TLS", "SMTP_USER",
  "SMTP_PASSWORD", "SMTP_FROM", "SMTP_TO"
] as const;

function readBoolean(value: string, variable: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${variable} must be true or false`);
}

export function readSmtpConfig(env: NodeJS.ProcessEnv): SmtpConfig | undefined {
  if (!SMTP_KEYS.some((key) => Boolean(env[key]))) return undefined;

  const required = [
    "SMTP_HOST", "SMTP_PORT", "SMTP_TLS", "SMTP_USER", "SMTP_PASSWORD", "SMTP_TO"
  ] as const;
  for (const key of required) {
    if (!env[key]) throw new Error(`${key} is required when SMTP is configured`);
  }

  const port = Number(env.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT must be an integer from 1 to 65535");
  }

  return {
    host: env.SMTP_HOST!,
    port,
    tls: readBoolean(env.SMTP_TLS!, "SMTP_TLS"),
    user: env.SMTP_USER!,
    password: env.SMTP_PASSWORD!,
    from: env.SMTP_FROM || env.SMTP_USER!,
    to: env.SMTP_TO!
  };
}

export function formatFailureNotification(
  failures: FailureSummary[]
): FailureNotification {
  const details = failures.map((failure) => {
    const account = failure.account === undefined
      ? "job"
      : `account ${failure.account}${failure.accountLabel ? ` (${failure.accountLabel})` : ""}`;
    return `- ${account}: ${failure.status}: ${failure.message}`;
  });

  return {
    subject: `[ViewTurbo Daily] ${failures.length} account failure(s)`,
    text: [
      "ViewTurbo Daily encountered the following failure(s):", "",
      ...details, "", `Time: ${new Date().toISOString()}`
    ].join("\n")
  };
}

export async function sendFailureNotification(
  config: SmtpConfig,
  failures: FailureSummary[]
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.tls && config.port === 465,
    requireTLS: config.tls && config.port !== 465,
    auth: { user: config.user, pass: config.password }
  });

  await transporter.sendMail({
    from: config.from,
    to: config.to,
    ...formatFailureNotification(failures)
  });
}
