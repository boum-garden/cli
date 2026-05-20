# boum

Command-line interface for the Boum IoT REST API. Use it to sign in, manage
devices, send device commands, configure refill and device tuning, and query
telemetry.

## Requirements

- Node.js 18 or newer
- npm
- git, when installing with `install.sh`

## Installation

Install from the hosted script:

```sh
curl -fsSL https://raw.githubusercontent.com/boum-garden/cli/main/install.sh | bash
```

The script clones the repository into `~/.local/lib/boum-cli`, builds the
TypeScript source, and symlinks `boum` into `~/.local/bin`.

You can customize the installation with environment variables:

```sh
BOUM_REPO=https://github.com/boum-garden/cli.git
BOUM_REF=main
BOUM_SUBDIR=.
BOUM_PREFIX="$HOME/.local/bin"
BOUM_LIB_DIR="$HOME/.local/lib/boum-cli"
```

From a local checkout:

```sh
cd cli
npm install
npm run build
ln -sf "$PWD/dist/index.js" ~/.local/bin/boum
```

Make sure `~/.local/bin` is on your `PATH`.

## First-Time Setup

Choose the API environment. The value is stored in
`~/.config/boum/config.json`.

```sh
boum config set env prod
```

Supported environments are:

- `prod`: `https://api.boum.us/v1`
- `dev`: `https://api-dev.boum.us/v1`
- `local`: `http://localhost:3000/dev/v1`

Sign in:

```sh
boum auth signin --email you@example.com
```

Access and refresh tokens are stored locally. The CLI automatically refreshes
the access token when possible.

Optionally set a default device so commands can omit `deviceId`:

```sh
boum config set defaultDeviceId <uuid>
```

Switch the API environment with `--env`. The value is **persisted** to the
config file, so every later command keeps using it until you switch back:

```sh
boum --env dev devices list-claimed
```

## Commands

### Auth

```sh
boum auth signin
boum auth refresh
boum auth whoami
boum auth logout
```

### Devices

```sh
boum devices list-claimed
boum devices get [deviceId]
boum devices owner [deviceId]
boum devices claim <deviceId> [userId]
boum devices unclaim <deviceId>
boum devices update [deviceId] --set key=value [--set ...]
boum devices update [deviceId] --desired '<json>'
boum devices cmd [deviceId] <command>
boum devices pump [deviceId] on|off
boum devices refill [deviceId] [--slot 1|2|3] [--enabled on|off] [--time HH:MM]
boum devices tune [deviceId] [--max-pump-duration 40min] [--refill-interval 7days]
boum devices tune [deviceId] [--max-pub-interval 60s] [--h-max-pub-interval 90s]
boum devices tune [deviceId] [--leakage-detection on|off] [--min-flow-rate 0.11]
```

Allowed device commands: `resetWiFiCredentials`, `restartDevice`, and
`resetLastPumped`. Any other value is rejected.

`unclaim`, `pump … on`, `cmd … resetWiFiCredentials` and `cmd … restartDevice`
ask for confirmation before running. Pass `-y` / `--yes` to skip the prompt
(e.g. in scripts).

`tune` writes to `state.desired`. `--max-pub-interval` / `--h-max-pub-interval`
set the maximum time between measurements below / above 90% battery. Each
duration flag has a fixed unit: `--max-pump-duration` in minutes (`40min`),
`--refill-interval` in days (`7days`), `--max-pub-interval` /
`--h-max-pub-interval` in seconds (`60s`).

### Telemetry Data

```sh
boum data get <deviceId> <FROM> <TO> [--interval 1h]
boum data get <FROM> <TO> [--interval 1h]
boum data last-hour [deviceId]
boum data last-24h [deviceId]
boum data last-7d [deviceId]
```

`FROM` and `TO` accept `now`, a relative offset such as `7d`, `1h`, `30m`
(counted back from now), or an ISO 8601 timestamp:

```sh
boum data get <deviceId> 7d now
```

A leading `-` is also accepted (`-7d`), but then the value must follow a `--`
separator so it is not parsed as an option.

### Config

```sh
boum config show
boum config get <key>
boum config set <key> <value>
boum config unset <key>
boum config path
```

Use `--json` on read commands to emit raw JSON instead of a table.

### Raw API access

To script against the REST API directly instead of using the CLI, see
[API.md](API.md) — it lists the `curl` equivalent of every command.

## Examples

```sh
boum devices list-claimed --json
boum devices get a9171ecd-f756-4fbc-ba93-bc1e65115b37
boum devices pump 5734535f-d086-40e9-ad4f-3eb9aae7125d on
boum devices refill 5734535f-d086-40e9-ad4f-3eb9aae7125d --slot 1 --time 07:30
boum devices tune 5734535f-d086-40e9-ad4f-3eb9aae7125d --max-pump-duration 40min --refill-interval 7days
boum devices tune 5734535f-d086-40e9-ad4f-3eb9aae7125d --max-pub-interval 60s --leakage-detection on
boum devices cmd 2a650b37-9645-46e0-825e-4a5319c09b03 restartDevice
boum devices cmd 2a650b37-9645-46e0-825e-4a5319c09b03 resetWiFiCredentials
boum devices cmd 2a650b37-9645-46e0-825e-4a5319c09b03 resetLastPumped
boum data get 3dabb2ef-0fd9-483c-bd51-09c60beb0463 7d 1h --interval 1h
boum data get 7d now --interval 1h
```

The last example uses `defaultDeviceId` from the local config.

## Security

`boum` stores credentials locally and sends them to the API. Be aware of the
following:

- **Tokens are stored in plaintext.** `boum auth signin` writes the access and
  refresh tokens to `~/.config/boum/config.json` (created with file mode `600`
  and directory mode `700`). Anyone able to read that file — including backups,
  synced folders, or another user with elevated rights — can act as you. Run
  `boum auth logout` to delete the stored tokens.
- **Don't pass the password as a flag.** `boum auth signin -p <password>`
  leaves the password in your shell history and exposes it to other users via
  the process list (`ps`). Omit `-p` and let the CLI prompt for it — the prompt
  does not echo the input.
- **Some commands print tokens in clear text.** `boum auth signin --json`,
  `boum config show --raw` and `boum config get accessToken` write raw tokens
  to stdout. Keep their output out of logs, CI output, issue trackers and
  screen shares. Plain `boum config show` redacts tokens by default.
- **`baseUrlOverride` redirects everything.** `boum config set baseUrlOverride
  <url>` sends all requests, with your token attached, to that URL. Only point
  it at a host you trust, and be cautious of commands others ask you to run.

## Development

```sh
npm install
npm run build
npm run dev
node dist/index.js --help
```

Useful scripts:

- `npm run build`: compile TypeScript into `dist/`
- `npm run dev`: compile in watch mode
- `npm run start`: run `dist/index.js`
- `npm run clean`: remove `dist/`

## License

MIT — see [LICENSE](LICENSE).
