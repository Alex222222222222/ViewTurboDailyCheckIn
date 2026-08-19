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

```sh
docker build -t viewturbo-daily .
docker run --rm \
  -e TOKEN_BASE64="$TOKEN_BASE64" \
  -e LOGIN_CREDENTIALS_BASE64="$LOGIN_CREDENTIALS_BASE64" \
  viewturbo-daily
```

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

Store the encoded value in a Secret and expose it as an environment variable:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: viewturbo-daily
spec:
  schedule: "0 1 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: check-in
              image: your-registry/viewturbo-daily:latest
              env:
                - name: TOKEN_BASE64
                  valueFrom:
                    secretKeyRef:
                      name: viewturbo-cookie
                      key: token-base64
                - name: LOGIN_CREDENTIALS_BASE64
                  valueFrom:
                    secretKeyRef:
                      name: viewturbo-cookie
                      key: login-credentials-base64
                - name: SMTP_HOST
                  value: smtp.example.com
                - name: SMTP_PORT
                  value: "587"
                - name: SMTP_TLS
                  value: "true"
                - name: SMTP_USER
                  valueFrom:
                    secretKeyRef:
                      name: viewturbo-smtp
                      key: user
                - name: SMTP_PASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: viewturbo-smtp
                      key: password
                - name: SMTP_TO
                  value: target@example.com
              resources:
                requests:
                  memory: 256Mi
                  cpu: 100m
                limits:
                  memory: 512Mi
                  cpu: 500m
```

Base64 is encoding, not encryption. Kubernetes Secret manifests also expect
their `data` values to be base64-encoded, so use `stringData` when creating a
manifest manually to avoid accidentally encoding this value a second time.
