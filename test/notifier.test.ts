import assert from "node:assert/strict";
import test from "node:test";
import { formatFailureNotification, readSmtpConfig } from "../src/notifier.js";

test("disables SMTP when no SMTP variables are present", () => {
  assert.equal(readSmtpConfig({}), undefined);
});

test("reads SMTP configuration and defaults the sender", () => {
  assert.deepEqual(readSmtpConfig({
    SMTP_HOST: "smtp.example.com", SMTP_PORT: "465", SMTP_TLS: "true",
    SMTP_USER: "sender@example.com", SMTP_PASSWORD: "secret",
    SMTP_TO: "target@example.com"
  }), {
    host: "smtp.example.com", port: 465, tls: true,
    user: "sender@example.com", password: "secret",
    from: "sender@example.com", to: "target@example.com"
  });
});

test("validates partial and malformed SMTP configuration", () => {
  assert.throws(() => readSmtpConfig({ SMTP_HOST: "smtp.example.com" }), /SMTP_PORT/);
  const base = {
    SMTP_HOST: "smtp.example.com", SMTP_USER: "sender@example.com",
    SMTP_PASSWORD: "secret", SMTP_TO: "target@example.com"
  };
  assert.throws(() => readSmtpConfig({ ...base, SMTP_PORT: "bad", SMTP_TLS: "true" }), /SMTP_PORT must/);
  assert.throws(() => readSmtpConfig({ ...base, SMTP_PORT: "587", SMTP_TLS: "yes" }), /SMTP_TLS must/);
});

test("failure notifications identify affected accounts", () => {
  const notification = formatFailureNotification([
    {
      account: 1,
      accountLabel: "token ending ...6cKf",
      status: "login_failed",
      message: "account status did not load"
    },
    {
      account: 2,
      accountLabel: "person@example.com",
      status: "error",
      message: "check-in failed"
    }
  ]);

  assert.equal(notification.subject, "[ViewTurbo Daily] 2 account failure(s)");
  assert.match(notification.text, /account 1 \(token ending \.\.\.6cKf\): login_failed/);
  assert.match(notification.text, /account 2 \(person@example\.com\): error/);
});
