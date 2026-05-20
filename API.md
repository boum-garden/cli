# Boum API — curl Recipes

The `boum` CLI is a thin wrapper over the Boum IoT REST API. If you would
rather script against the API directly, this document gives the raw `curl`
equivalent of every CLI command.

## Conventions

- **Base URL** depends on the environment your account lives in:

  | Environment | Base URL |
  |-------------|----------|
  | `prod`  | `https://api.boum.us/v1` |
  | `dev`   | `https://api-dev.boum.us/v1` |
  | `local` | `http://localhost:3000/dev/v1` |

- **Authentication:** the access token is sent **raw** in the `Authorization`
  header — there is **no `Bearer ` prefix**:

  ```
  Authorization: <accessToken>
  ```

- Requests with a body send `Content-Type: application/json`. The CLI also
  sends `Accept: application/json` on every request.
- **Successful responses are wrapped in a `{ "data": ... }` envelope.** Error
  responses use a non-2xx status and a `{ "message": "..." }` body.
- Examples use `curl -sS` (no progress meter, but errors are shown) and pipe
  to `jq` only where output needs parsing. Install `jq` for readable output.

### Setup

Set these shell variables once, then paste the examples below as-is:

```sh
BASE=https://api.boum.us/v1
DEVICE=<deviceId>      # e.g. a serialNumber from `devices list-claimed`
# TOKEN and USER_ID are filled in by the auth steps below
```

## Authentication

These endpoints do **not** require the `Authorization` header.

### Sign in — `POST /auth/signin`

CLI: `boum auth signin`. Returns `accessToken` and `refreshToken` inside `data`.

```sh
curl -sS -X POST "$BASE/auth/signin" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"YOUR_PASSWORD"}'
```

Capture the tokens into shell variables for the authenticated calls below:

```sh
RESP=$(curl -sS -X POST "$BASE/auth/signin" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"YOUR_PASSWORD"}')
TOKEN=$(echo "$RESP" | jq -r '.data.accessToken')
REFRESH=$(echo "$RESP" | jq -r '.data.refreshToken')
```

### Refresh the access token — `POST /auth/token`

CLI: `boum auth refresh`. Access tokens expire; when a call returns `401`,
exchange the refresh token for a fresh access token and retry. The CLI does
this automatically — with raw curl you must do it yourself.

```sh
curl -sS -X POST "$BASE/auth/token" \
  -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\"}"
```

## Users

### Current user — `GET /users`

CLI: `boum auth whoami`

```sh
curl -sS "$BASE/users" -H "Authorization: $TOKEN"
```

## Devices

All device endpoints require the `Authorization` header.

### List claimed devices — `GET /devices/claimed`

CLI: `boum devices list-claimed`

```sh
curl -sS "$BASE/devices/claimed" -H "Authorization: $TOKEN"
```

### Get a device — `GET /devices/:deviceId`

CLI: `boum devices get`. Returns the device shadow (`state.desired` /
`state.reported`).

```sh
curl -sS "$BASE/devices/$DEVICE" -H "Authorization: $TOKEN"
```

### Get the device owner — `GET /devices/:deviceId/owner`

CLI: `boum devices owner`

```sh
curl -sS "$BASE/devices/$DEVICE/owner" -H "Authorization: $TOKEN"
```

### Claim a device — `PUT /devices/:deviceId/claim`

CLI: `boum devices claim`

```sh
curl -sS -X PUT "$BASE/devices/$DEVICE/claim" -H "Authorization: $TOKEN"
```

Claim on behalf of another user — `PUT /devices/:deviceId/claim/:userId`:

```sh
curl -sS -X PUT "$BASE/devices/$DEVICE/claim/$USER_ID" -H "Authorization: $TOKEN"
```

### Unclaim a device — `DELETE /devices/:deviceId/claim`

CLI: `boum devices unclaim`

```sh
curl -sS -X DELETE "$BASE/devices/$DEVICE/claim" -H "Authorization: $TOKEN"
```

### Update device state — `PATCH /devices/:deviceId`

Everything that changes device behaviour is a `PATCH` that writes into
`state.desired`. The body shape is always:

```json
{ "state": { "desired": { ... } } }
```

The CLI exposes several typed shortcuts (`cmd`, `pump`, `refill`, `tune`) on
top of this one endpoint — they all produce the same request with a different
`desired` payload.

#### Generic update — CLI: `boum devices update`

```sh
curl -sS -X PATCH "$BASE/devices/$DEVICE" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"state":{"desired":{"pumpState":"off"}}}'
```

#### Send a device command — CLI: `boum devices cmd`

```sh
curl -sS -X PATCH "$BASE/devices/$DEVICE" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"state":{"desired":{"deviceCommands":["restartDevice"]}}}'
```

Commands allowed by the CLI: `resetWiFiCredentials`, `restartDevice`,
`resetLastPumped`.

#### Pump on/off — CLI: `boum devices pump`

```sh
curl -sS -X PATCH "$BASE/devices/$DEVICE" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"state":{"desired":{"pumpState":"on"}}}'
```

#### Refill schedule — CLI: `boum devices refill`

Slot 1 uses the keys `dailyRefill` + `refillTimeOne`, slot 2
`dailyRefillTwo` + `refillTimeTwo`, slot 3 `dailyRefillThree` +
`refillTimeThree`. Times are `HH:MM`; enable flags are `on` / `off`.

```sh
# Enable slot 1, refill daily at 07:30
curl -sS -X PATCH "$BASE/devices/$DEVICE" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"state":{"desired":{"dailyRefill":"on","refillTimeOne":"07:30"}}}'
```

#### Device tuning — CLI: `boum devices tune`

Each field has a fixed format:

| Field | Format | Example |
|-------|--------|---------|
| `maxPumpDuration`  | `<n>min`  | `"40min"` |
| `refillInterval`   | `<n>days` | `"7days"` |
| `maxPubInterval`   | `<n>s`    | `"60s"` |
| `hMaxPubInterval`  | `<n>s`    | `"90s"` |
| `leakageDetection` | `on` / `off` | `"on"` |
| `minFlowRate`      | number    | `0.11` |

```sh
curl -sS -X PATCH "$BASE/devices/$DEVICE" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"state":{"desired":{"maxPumpDuration":"40min","refillInterval":"7days","maxPubInterval":"60s","leakageDetection":"on","minFlowRate":0.11}}}'
```

## Telemetry data

### Device data — `GET /devices/:deviceId/data`

CLI: `boum data get` and the `last-*` shortcuts.

Query parameters:

- `interval` — aggregation bucket, e.g. `10s`, `1m`, `1h`.
- `timeStart`, `timeEnd` — relative tokens (`-7d`, `-1h`, `-30m`) or absolute
  ISO 8601 timestamps. Omit `timeEnd` for "until now".

```sh
# Last 7 days at 1h resolution
curl -sS "$BASE/devices/$DEVICE/data?timeStart=-7d&interval=1h" \
  -H "Authorization: $TOKEN"

# Explicit window with absolute timestamps
curl -sS -G "$BASE/devices/$DEVICE/data" \
  -H "Authorization: $TOKEN" \
  --data-urlencode 'timeStart=2026-05-01T00:00:00' \
  --data-urlencode 'timeEnd=2026-05-08T00:00:00' \
  --data-urlencode 'interval=1h'
```

The CLI shortcuts map to:

| CLI | Request |
|-----|---------|
| `data last-hour` | `GET /devices/:id/data?timeStart=-1h&interval=10s` |
| `data last-24h`  | `GET /devices/:id/data` (no params — server default window) |
| `data last-7d`   | `GET /devices/:id/data?timeStart=-7d&interval=1h` |

## CLI ↔ endpoint reference

| CLI command | Method & path |
|-------------|---------------|
| `auth signin`          | `POST /auth/signin` |
| `auth refresh`         | `POST /auth/token` |
| `auth whoami`          | `GET /users` |
| `auth logout`          | local only — clears stored tokens |
| `devices list-claimed` | `GET /devices/claimed` |
| `devices get`          | `GET /devices/:id` |
| `devices owner`        | `GET /devices/:id/owner` |
| `devices claim`        | `PUT /devices/:id/claim[/:userId]` |
| `devices unclaim`      | `DELETE /devices/:id/claim` |
| `devices update`       | `PATCH /devices/:id` |
| `devices cmd`          | `PATCH /devices/:id` — `deviceCommands` |
| `devices pump`         | `PATCH /devices/:id` — `pumpState` |
| `devices refill`       | `PATCH /devices/:id` — `dailyRefill*` / `refillTime*` |
| `devices tune`         | `PATCH /devices/:id` — tuning fields |
| `data get` / `last-*`  | `GET /devices/:id/data` |
| `config *`             | local only — `~/.config/boum/config.json` |

## Notes

- `boum config` and `boum auth logout` never touch the API; they only read and
  write `~/.config/boum/config.json`.
- The CLI automatically retries with a refreshed access token after a `401`.
  With raw curl you must refresh via `POST /auth/token` yourself.
