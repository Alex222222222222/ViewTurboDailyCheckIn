import puppeteer, { type Browser, type Page } from "puppeteer-core";
import {
  decodeAccounts,
  readTimeout,
  type AccountCredentials
} from "./config.js";
import {
  readSmtpConfig,
  sendFailureNotification,
  type FailureSummary
} from "./notifier.js";

const TARGET_URL = "https://viewturbo.org/zh/my";
const LOGIN_URL = "https://viewturbo.org/zh/login";
const STATUS_SELECTOR = ".my-checkin-entry__title";
const CHECKED_IN_TEXT = "今日已领";
const UNCHECKED_TEXT = "签到领";

type CheckInStatus =
  | "already_checked_in"
  | "checked_in"
  | "login_failed"
  | "error"
  | "fatal";

class LoginError extends Error {
  override readonly name = "LoginError";
}

interface Result {
  account?: number;
  status: CheckInStatus;
  message: string;
}

function output(result: Result): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function getStatusText(page: Page): Promise<string> {
  return page.$eval(STATUS_SELECTOR, (element) => element.textContent?.trim() ?? "");
}

async function connectToBrowser(endpoint: string, timeout: number): Promise<Browser> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  do {
    try {
      return await puppeteer.connect({ browserWSEndpoint: endpoint });
    } catch (error: unknown) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } while (Date.now() < deadline);

  throw new Error(
    `failed to connect to browser service within ${timeout}ms: ${errorMessage(lastError)}`
  );
}

async function login(page: Page, credentials: Extract<AccountCredentials, { source: "login" }>, timeout: number): Promise<void> {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout });

  const cookieActions = await page.$$(".cookie-action-button");
  if (cookieActions.length > 0) {
    await cookieActions[0]!.click();
    await page.waitForSelector(".cookie-action-button", { hidden: true, timeout });
  }

  await new Promise((resolve) => setTimeout(resolve, 5_000));
  await page.waitForSelector('input[type="email"]', { visible: true, timeout });
  await page.waitForSelector('input[type="password"]', { visible: true, timeout });
  await page.locator('input[type="email"]').fill(credentials.email);
  await page.locator('input[type="password"]').fill(credentials.password);
  await page.focus('input[type="password"]');
  await page.keyboard.press("Enter");

  try {
    await page.waitForFunction(() => {
      try {
        const user = JSON.parse(localStorage.getItem("user") ?? "{}");
        return typeof user.token === "string" && user.token.length > 0;
      } catch {
        return false;
      }
    }, { timeout });
  } catch {
    throw new LoginError("failed to log in: credentials were not accepted");
  }
}

async function checkIn(
  browser: Browser,
  credentials: AccountCredentials,
  account: number,
  timeout: number
): Promise<Result> {
  const context = await browser.createBrowserContext();

  try {
    await context.setCookie(
      {
        name: "i18n_redirected",
        value: "zh",
        domain: "viewturbo.org",
        path: "/",
        secure: true,
        sameSite: "Lax"
      },
      {
        name: "userCookieChoice",
        value: "rejected",
        domain: "viewturbo.org",
        path: "/",
        secure: true
      }
    );

    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    if (credentials.source === "token") {
      await page.evaluateOnNewDocument((token: string) => {
        localStorage.setItem("user", JSON.stringify({ token }));
      }, credentials.token);
    } else {
      await login(page, credentials, timeout);
    }
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout });

    try {
      await page.waitForFunction(
        (selector: string, checked: string, unchecked: string) => {
          const path = window.location.pathname.replace(/\/$/, "");
          const text = document.querySelector(selector)?.textContent ?? "";
          return path !== "/zh/my" || text.includes(checked) || text.includes(unchecked);
        },
        { timeout },
        STATUS_SELECTOR,
        CHECKED_IN_TEXT,
        UNCHECKED_TEXT
      );
    } catch {
      const unsettled = await page
        .$eval(STATUS_SELECTOR, (element) => element.textContent?.trim() ?? "")
        .catch(() => "");
      throw new LoginError(
        `failed to log in: account status did not load within ${timeout}ms (final URL: ${page.url()}, last status: ${JSON.stringify(unsettled)})`
      );
    }

    if (new URL(page.url()).pathname.replace(/\/$/, "") !== "/zh/my") {
      throw new LoginError(`failed to log in: redirected to ${page.url()}`);
    }

    const before = await getStatusText(page);
    if (before.includes(CHECKED_IN_TEXT)) {
      return { account, status: "already_checked_in", message: before };
    }

    if (!before.includes(UNCHECKED_TEXT)) {
      throw new Error(`unrecognized check-in status: ${JSON.stringify(before)}`);
    }

    const entry = await page.$("button.my-checkin-entry");
    if (!entry) {
      throw new Error("check-in entry is not clickable");
    }

    await entry.evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    try {
      await page.waitForFunction(
        (selector: string, expected: string) =>
          document.querySelector(selector)?.textContent?.includes(expected),
        { timeout },
        STATUS_SELECTOR,
        CHECKED_IN_TEXT
      );
    } catch {
      const afterClick = await getStatusText(page);
      throw new Error(
        `check-in did not complete within ${timeout}ms (last status: ${JSON.stringify(afterClick)})`
      );
    }

    return {
      account,
      status: "checked_in",
      message: await getStatusText(page)
    };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const accounts = decodeAccounts(
    process.env.TOKEN_BASE64,
    process.env.LOGIN_CREDENTIALS_BASE64
  );
  const timeout = readTimeout(process.env.TIMEOUT_MS);
  const smtp = readSmtpConfig(process.env);
  const executablePath = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
  const browserWSEndpoint = process.env.BROWSER_WS_ENDPOINT;
  let browser: Browser | undefined;

  try {
    browser = browserWSEndpoint
      ? await connectToBrowser(browserWSEndpoint, timeout)
      : await puppeteer.launch({
          executablePath,
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        });

    let failed = false;
    const failures: FailureSummary[] = [];
    for (const [index, credentials] of accounts.entries()) {
      const account = index + 1;
      try {
        output(await checkIn(browser, credentials, account, timeout));
      } catch (error: unknown) {
        failed = true;
        const result: Result = {
          account,
          status: error instanceof LoginError ? "login_failed" : "error",
          message: errorMessage(error)
        };
        failures.push(result);
        output(result);
      }
    }

    if (smtp && failures.length > 0) {
      try {
        await sendFailureNotification(smtp, failures);
      } catch (error: unknown) {
        failed = true;
        output({
          status: "error",
          message: `email notification failed: ${errorMessage(error)}`
        });
      }
    }

    if (failed) process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}

main().catch((error: unknown) => {
  output({ status: "fatal", message: errorMessage(error) });
  process.exitCode = 1;
});
