import assert from "node:assert/strict";
import test from "node:test";
import { decodeAccounts, readTimeout } from "../src/config.js";

test("decodes one account", () => {
  const token = "token-one";
  assert.deepEqual(
    decodeAccounts(Buffer.from(token).toString("base64"), undefined),
    [{ source: "token", token }]
  );
});

test("decodes pipe-separated accounts", () => {
  const tokens = ["token-one", "token-two"];
  assert.deepEqual(
    decodeAccounts(Buffer.from(tokens.join("|")).toString("base64"), undefined),
    [
      { source: "token", token: tokens[0] },
      { source: "token", token: tokens[1] }
    ]
  );
});

test("extracts tokens from structured user JSON", () => {
  const users = [
    JSON.stringify({ token: "token-one", email: "one@example.com" }),
    JSON.stringify({ token: "token-two", loginPassword: "not-needed" })
  ];

  assert.deepEqual(
    decodeAccounts(Buffer.from(users.join("|")).toString("base64"), undefined),
    [
      { source: "token", token: "token-one" },
      { source: "token", token: "token-two" }
    ]
  );
});

test("rejects structured user JSON without a token", () => {
  const encoded = Buffer.from(JSON.stringify({ email: "one@example.com" })).toString("base64");

  assert.throws(() => decodeAccounts(encoded, undefined), /requires a non-empty token/);
});

test("rejects missing, malformed, and entirely empty accounts", () => {
  assert.throws(() => decodeAccounts(undefined, undefined), /is required/);
  assert.throws(() => decodeAccounts("not base64", undefined), /valid base64/);
  assert.throws(
    () => decodeAccounts(Buffer.from("||").toString("base64"), undefined, () => undefined),
    /is required/
  );
});

test("warns and skips empty accounts when a usable token remains", () => {
  const warnings: string[] = [];
  const encoded = Buffer.from("|token-one||token-two|").toString("base64");

  assert.deepEqual(
    decodeAccounts(encoded, undefined, (message) => warnings.push(message)),
    [
      { source: "token", token: "token-one" },
      { source: "token", token: "token-two" }
    ]
  );
  assert.deepEqual(warnings, [
    "TOKEN_BASE64 contains 3 empty account(s); skipping them"
  ]);
});

test("decodes structured login credentials and combines both input methods", () => {
  const token = Buffer.from("direct-token").toString("base64");
  const logins = Buffer.from(
    JSON.stringify([
      { email: "one@example.com", password: "secret-one" },
      { email: "two@example.com", password: "secret-two" }
    ])
  ).toString("base64");

  assert.deepEqual(decodeAccounts(token, logins), [
    { source: "token", token: "direct-token" },
    { source: "login", email: "one@example.com", password: "secret-one" },
    { source: "login", email: "two@example.com", password: "secret-two" }
  ]);
});

test("rejects malformed structured login credentials", () => {
  const object = Buffer.from(JSON.stringify({ email: "one@example.com" })).toString("base64");
  const missingPassword = Buffer.from(
    JSON.stringify([{ email: "one@example.com" }])
  ).toString("base64");

  assert.throws(() => decodeAccounts(undefined, object), /JSON array/);
  assert.throws(() => decodeAccounts(undefined, missingPassword), /email and password/);
});

test("validates timeout bounds", () => {
  assert.equal(readTimeout(undefined), 30_000);
  assert.equal(readTimeout("45000"), 45_000);
  assert.throws(() => readTimeout("100"), /1000 to 120000/);
});
