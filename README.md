# ViewTurbo Daily Check-in

A one-shot Chromium/Puppeteer job. It prints one JSON line per account and exits
with status `1` when any account fails.

## Prepare the secret

Join the raw account tokens with `|`, then base64-encode the entire string.

```sh
export TOKEN_BASE64="$(printf '%s' 'account-one-token|account-two-token' | base64)"
```

Alternatively, or in addition, provide email/password accounts as a
base64-encoded JSON array:

```sh
export LOGIN_CREDENTIALS_BASE64="$(printf '%s' '[{"email":"one@example.com","password":"secret-one"},{"email":"two@example.com","password":"secret-two"}]' | base64)"
```

Direct-token accounts run first, followed by login accounts in array order.

For each account, the job stores `{"token":"..."}` under the `user`
local-storage key. It also sets `i18n_redirected=zh` and
`userCookieChoice=rejected`. Secret values are never printed.

Empty values between separators are skipped with a warning. The job fails only
when the decoded input contains no usable tokens.

## Docker

Published image:

```text
ghcr.io/<github-owner>/<repository>:latest
```

The workflow derives this path from the actual GitHub repository and converts
it to lowercase. For example, `ExampleOrg/ViewTurboDaily` publishes as:

```text
ghcr.io/exampleorg/viewturbodaily:latest
```

The application image does not contain Chromium. It connects to a Browserless
Chromium container through `BROWSER_WS_ENDPOINT`, keeping builds smaller and
allowing the browser to run as a Compose service or Kubernetes sidecar.

Run both containers locally:

```sh
export BROWSERLESS_TOKEN="replace-with-a-random-secret"
docker compose up --build --abort-on-container-exit --exit-code-from checkin
```

Compose connects the job to `ws://browser:3000` and gives Chromium a 2 GiB
shared-memory allocation. Set `CHECKIN_IMAGE` if you adapt the Compose file to
pull the published application image instead of building locally.

Example output:

```json
{"account":1,"status":"already_checked_in","message":"今日已领 100MB"}
{"account":2,"status":"checked_in","message":"今日已领 100MB"}
```

An invalid or expired token produces a failed result without exposing the
token:

```json
{"account":1,"status":"login_failed","message":"failed to log in: check-in control not found (final URL: https://viewturbo.org/zh/my)"}
```

If the unauthenticated page renders only the temporary `签到挚会员` shell, it is
also reported as `login_failed` when the status does not resolve by
`TIMEOUT_MS`.

A redirect from `/zh/my` to `/zh/` is detected immediately as `login_failed`.
Navigation waits for the document rather than network idleness, so media on the
redirected landing page cannot hold the job open.

`TIMEOUT_MS` is optional and defaults to `30000`.

The page can temporarily show `签到挚会员` while loading account state. The job
waits up to `TIMEOUT_MS` for an explicit checked (`今日已领`) or unchecked
(`签到领`) status and clicks only the unchecked state.

## Failure email

SMTP is optional. When configured, the job sends one summary email if any
account returns `login_failed` or `error`:

```sh
docker run --rm \
  -e TOKEN_BASE64="$TOKEN_BASE64" \
  -e SMTP_HOST="smtp.example.com" \
  -e SMTP_PORT="587" \
  -e SMTP_TLS="true" \
  -e SMTP_USER="sender@example.com" \
  -e SMTP_PASSWORD="smtp-password" \
  -e SMTP_FROM="ViewTurbo Daily <sender@example.com>" \
  -e SMTP_TO="target@example.com" \
  viewturbo-daily
```

With port `465`, `SMTP_TLS=true` uses implicit TLS. On other ports it requires
STARTTLS. `SMTP_FROM` is optional and defaults to `SMTP_USER`. Supplying any
SMTP variable requires all other values except `SMTP_FROM`.

## Kubernetes CronJob

[kubernetes-cronjob.yaml](kubernetes-cronjob.yaml) uses Browserless as a native
sidecar and memory-backed `/dev/shm`. Before applying it:

1. Replace `ghcr.io/GITHUB_OWNER/REPOSITORY:latest` with the lowercase image URL
   printed by the GitHub workflow.
2. Create `viewturbo-cookie` with the account input.
3. Create `viewturbo-browser` with `token` and an `endpoint` value formatted as
   `ws://localhost:3000?token=<the-same-token>`.

The native sidecar uses `restartPolicy: Always` under `initContainers`, allowing
Kubernetes to stop Browserless automatically when the one-shot job exits.

Base64 is encoding, not encryption. Kubernetes Secret manifests also expect
their `data` values to be base64-encoded, so use `stringData` when creating a
manifest manually to avoid accidentally encoding this value a second time.
