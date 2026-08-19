const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export type AccountCredentials =
  | { source: "token"; token: string }
  | { source: "login"; email: string; password: string };

interface LoginCredentials {
  email: string;
  password: string;
}

function extractToken(value: string, index: number): string {
  if (!value.startsWith("{")) return value;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`TOKEN_BASE64 account ${index} contains invalid user JSON`);
  }

  const token = (parsed as { token?: unknown } | null)?.token;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error(`TOKEN_BASE64 account ${index} user JSON requires a non-empty token`);
  }

  return token.trim();
}

function decodeBase64(encoded: string, variable: string): string {
  const compact = encoded.trim();
  if (!compact || compact.length % 4 !== 0 || !BASE64_PATTERN.test(compact)) {
    throw new Error(`${variable} is not valid base64`);
  }
  return Buffer.from(compact, "base64").toString("utf8");
}

export function decodeAccounts(
  encodedTokens: string | undefined,
  encodedLogins: string | undefined,
  warn: (message: string) => void = console.warn
): AccountCredentials[] {
  const accounts: AccountCredentials[] = [];

  if (encodedTokens) {
    const tokens = decodeBase64(encodedTokens, "TOKEN_BASE64")
      .split("|")
      .map((value) => value.trim());
    const validTokens = tokens.filter(Boolean);

    const skipped = tokens.length - validTokens.length;
    if (skipped > 0) {
      warn(`TOKEN_BASE64 contains ${skipped} empty account(s); skipping them`);
    }

    accounts.push(
      ...validTokens.map((value, index) => ({
        source: "token" as const,
        token: extractToken(value, index + 1)
      }))
    );
  }

  if (encodedLogins) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeBase64(encodedLogins, "LOGIN_CREDENTIALS_BASE64"));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("LOGIN_CREDENTIALS_BASE64 must decode to valid JSON");
      }
      throw error;
    }

    if (!Array.isArray(parsed)) {
      throw new Error("LOGIN_CREDENTIALS_BASE64 must decode to a JSON array");
    }

    for (const [index, value] of parsed.entries()) {
      const candidate = value as Partial<LoginCredentials> | null;
      if (
        !candidate ||
        typeof candidate.email !== "string" ||
        !candidate.email.trim() ||
        typeof candidate.password !== "string" ||
        !candidate.password
      ) {
        throw new Error(
          `LOGIN_CREDENTIALS_BASE64 account ${index + 1} requires non-empty email and password strings`
        );
      }
      accounts.push({
        source: "login",
        email: candidate.email.trim(),
        password: candidate.password
      });
    }
  }

  if (accounts.length === 0) {
    throw new Error("TOKEN_BASE64 or LOGIN_CREDENTIALS_BASE64 is required");
  }

  return accounts;
}

export function readTimeout(value: string | undefined): number {
  if (value === undefined) return 30_000;

  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
    throw new Error("TIMEOUT_MS must be an integer from 1000 to 120000");
  }
  return timeout;
}
