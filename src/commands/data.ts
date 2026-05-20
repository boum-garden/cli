import { Command } from "commander";
import { apiRequest, unwrap } from "../http";
import { loadConfig } from "../config";
import { printJson, printTable } from "../output";

// Sibling `data` subcommands, so `data get last-hour ...` can be caught early.
const DATA_SHORTCUTS = ["last-hour", "last-24h", "last-7d"];

/**
 * Normalise a FROM/TO time argument: a relative offset like `7d`, `1h`, `30m`
 * (a leading `-` is optional and added back for the server), or an absolute
 * ISO 8601 timestamp. Returns undefined for empty input and for `now` — the
 * API treats an omitted bound as the current time — and throws a descriptive
 * error for anything else.
 */
function normalizeTime(input: string | undefined, label: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === "now") return undefined;
  // Relative offset into the past — accepted with or without a leading '-'.
  const rel = /^-?(\d+[smhdwMy])$/.exec(trimmed);
  if (rel) return `-${rel[1]}`;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
  }
  throw new Error(
    `invalid ${label} '${input}' — use 'now', a relative offset like 7d, 1h ` +
      "or 30m, or an ISO 8601 timestamp",
  );
}

function resolveDeviceId(explicit: string | undefined, optDevice: string | undefined): string {
  const pick = explicit ?? optDevice;
  if (pick && pick.length > 0) return pick;
  const cfg = loadConfig();
  if (cfg.defaultDeviceId) return cfg.defaultDeviceId;
  throw new Error(
    "deviceId required. Pass it positionally, use --device <id>, or set `boum config set defaultDeviceId <id>`.",
  );
}

export function registerDataCommands(program: Command): void {
  const data = program.command("data").description("Query device telemetry data");

  data
    .command("get [arg1] [arg2] [arg3]")
    .description("Query device telemetry — GET /devices/:deviceId/data")
    .option("-d, --device <deviceId>", "Device id (overrides positional)")
    .option("-i, --interval <interval>", "Aggregation interval, e.g. 10s, 1m, 1h", "1h")
    .option("--json", "Emit JSON")
    .addHelpText(
      "after",
      "\nUsage:\n" +
        "  boum data get <deviceId> <FROM> <TO>\n" +
        "  boum data get <FROM> <TO>          (uses defaultDeviceId or --device)\n" +
        "\nFROM/TO accept 'now', a relative offset like 7d, 1h or 30m (counted back\n" +
        "from now), or an ISO 8601 timestamp.",
    )
    .action(
      async (
        arg1: string | undefined,
        arg2: string | undefined,
        arg3: string | undefined,
        opts: { device?: string; interval: string; json?: boolean },
      ) => {
        if (arg1 && DATA_SHORTCUTS.includes(arg1)) {
          throw new Error(
            `'${arg1}' is a separate command, not an argument to 'data get'. ` +
              `Try: boum data ${arg1} ${arg2 ?? "<deviceId>"}`,
          );
        }
        let deviceId: string;
        let from: string | undefined;
        let to: string | undefined;
        if (arg3 !== undefined) {
          deviceId = arg1 as string;
          from = arg2;
          to = arg3;
        } else if (arg2 !== undefined) {
          if (opts.device) {
            deviceId = opts.device;
            from = arg1;
            to = arg2;
          } else if (looksLikeTime(arg1) && looksLikeTime(arg2)) {
            deviceId = resolveDeviceId(undefined, undefined);
            from = arg1;
            to = arg2;
          } else {
            deviceId = arg1 as string;
            from = arg2;
          }
        } else {
          deviceId = resolveDeviceId(arg1, opts.device);
        }

        const res = await apiRequest<unknown>({
          path: `/devices/${encodeURIComponent(deviceId)}/data`,
          query: {
            interval: opts.interval,
            timeStart: normalizeTime(from, "FROM"),
            timeEnd: normalizeTime(to, "TO"),
          },
          auth: true,
        });
        const body = unwrap<unknown>(res);
        if (opts.json) {
          printJson(body);
          return;
        }
        if (Array.isArray(body)) {
          printTable(body as Record<string, unknown>[]);
        } else {
          process.stdout.write(JSON.stringify(body, null, 2) + "\n");
        }
      },
    );

  data
    .command("last-24h [deviceId]")
    .description("Shortcut: last 24 hours at 1h interval")
    .option("--json", "Emit JSON")
    .action(async (deviceId: string | undefined, opts: { json?: boolean }) => {
      const id = resolveDeviceId(deviceId, undefined);
      const res = await apiRequest<unknown>({
        path: `/devices/${encodeURIComponent(id)}/data`,
        auth: true,
      });
      const body = unwrap<unknown>(res);
      if (opts.json) printJson(body);
      else if (Array.isArray(body)) printTable(body as Record<string, unknown>[]);
      else process.stdout.write(JSON.stringify(body, null, 2) + "\n");
    });

  data
    .command("last-7d [deviceId]")
    .description("Shortcut: last 7 days at 1h interval")
    .option("--json", "Emit JSON")
    .action(async (deviceId: string | undefined, opts: { json?: boolean }) => {
      const id = resolveDeviceId(deviceId, undefined);
      const res = await apiRequest<unknown>({
        path: `/devices/${encodeURIComponent(id)}/data`,
        query: { timeStart: "-7d", interval: "1h" },
        auth: true,
      });
      const body = unwrap<unknown>(res);
      if (opts.json) printJson(body);
      else if (Array.isArray(body)) printTable(body as Record<string, unknown>[]);
      else process.stdout.write(JSON.stringify(body, null, 2) + "\n");
    });

  data
    .command("last-hour [deviceId]")
    .description("Shortcut: last hour at 10s interval")
    .option("--json", "Emit JSON")
    .action(async (deviceId: string | undefined, opts: { json?: boolean }) => {
      const id = resolveDeviceId(deviceId, undefined);
      const res = await apiRequest<unknown>({
        path: `/devices/${encodeURIComponent(id)}/data`,
        query: { timeStart: "-1h", interval: "10s" },
        auth: true,
      });
      const body = unwrap<unknown>(res);
      if (opts.json) printJson(body);
      else if (Array.isArray(body)) printTable(body as Record<string, unknown>[]);
      else process.stdout.write(JSON.stringify(body, null, 2) + "\n");
    });
}

function looksLikeTime(s: string | undefined): boolean {
  if (!s) return false;
  if (s === "now") return true;
  if (/^-?\d+[smhdwMy]$/.test(s)) return true;
  return !Number.isNaN(new Date(s).getTime()) && /\d{4}-\d{2}-\d{2}/.test(s);
}
