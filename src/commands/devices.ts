import { Command } from "commander";
import { apiRequest, unwrap } from "../http";
import { printJson, printTable } from "../output";
import { loadConfig } from "../config";
import { prompt } from "../prompt";

const DEVICE_COLUMNS = ["deviceId", "state", "lastSeen", "createdAt"];

// Device commands the CLI permits (a deliberate subset of what the API accepts).
const DEVICE_COMMANDS = ["resetWiFiCredentials", "restartDevice", "resetLastPumped"];

function resolveDeviceId(arg: string | undefined): string {
  if (arg && arg.length > 0) return arg;
  const cfg = loadConfig();
  if (cfg.defaultDeviceId) return cfg.defaultDeviceId;
  throw new Error(
    "deviceId required. Pass it as an argument or set one via `boum config set defaultDeviceId <id>`.",
  );
}

function pickDeviceRow(d: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  // The API names the device identifier `serialNumber` (`id` mirrors it); the
  // CLI calls it `deviceId` everywhere, so surface it under that name.
  for (const c of DEVICE_COLUMNS) {
    row[c] = c === "deviceId" ? (d.serialNumber ?? d.id) : d[c];
  }
  return row;
}

async function patchDesired(
  deviceId: string,
  desired: Record<string, unknown>,
): Promise<unknown> {
  return apiRequest<unknown>({
    method: "PATCH",
    path: `/devices/${encodeURIComponent(deviceId)}`,
    body: { state: { desired } },
    auth: true,
  });
}

function emit(result: unknown, json: boolean | undefined, asTable?: () => void): void {
  const data = unwrap<unknown>(result);
  if (json) {
    printJson(data);
    return;
  }
  if (asTable) {
    asTable();
    return;
  }
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function registerDeviceCommands(program: Command): void {
  const devices = program.command("devices").description("Manage devices");

  devices
    .command("list-claimed")
    .description("List devices claimed by the current user — GET /devices/claimed")
    .option("--json", "Emit JSON")
    .action(async (opts: { json?: boolean }) => {
      const res = await apiRequest<unknown>({ path: "/devices/claimed", auth: true });
      const data = unwrap<Record<string, unknown>[]>(res);
      emit(res, opts.json, () => {
        if (!Array.isArray(data)) {
          process.stdout.write(JSON.stringify(data, null, 2) + "\n");
          return;
        }
        printTable(data.map(pickDeviceRow), DEVICE_COLUMNS);
      });
    });

  devices
    .command("get [deviceId]")
    .description("Get a device — GET /devices/:deviceId")
    .option("--json", "Emit JSON")
    .action(async (deviceId: string | undefined, opts: { json?: boolean }) => {
      const id = resolveDeviceId(deviceId);
      const res = await apiRequest<unknown>({
        path: `/devices/${encodeURIComponent(id)}`,
        auth: true,
      });
      emit(res, opts.json);
    });

  devices
    .command("owner [deviceId]")
    .description("Get the owner of a device — GET /devices/:deviceId/owner")
    .option("--json", "Emit JSON")
    .action(async (deviceId: string | undefined, opts: { json?: boolean }) => {
      const id = resolveDeviceId(deviceId);
      const res = await apiRequest<unknown>({
        path: `/devices/${encodeURIComponent(id)}/owner`,
        auth: true,
      });
      emit(res, opts.json);
    });

  devices
    .command("claim <deviceId> [userId]")
    .description(
      "Claim a device (optionally for another user) — PUT /devices/:deviceId/claim[/:userId]",
    )
    .option("--json", "Emit JSON")
    .action(async (deviceId: string, userId: string | undefined, opts: { json?: boolean }) => {
      const path = userId
        ? `/devices/${encodeURIComponent(deviceId)}/claim/${encodeURIComponent(userId)}`
        : `/devices/${encodeURIComponent(deviceId)}/claim`;
      const res = await apiRequest<unknown>({ method: "PUT", path, auth: true });
      emit(res, opts.json);
    });

  devices
    .command("unclaim <deviceId>")
    .description("Remove claim on a device — DELETE /devices/:deviceId/claim")
    .option("--json", "Emit JSON")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (deviceId: string, opts: { json?: boolean; yes?: boolean }) => {
      await confirmOrAbort(`Remove your claim on device ${deviceId}?`, opts.yes);
      const res = await apiRequest<unknown>({
        method: "DELETE",
        path: `/devices/${encodeURIComponent(deviceId)}/claim`,
        auth: true,
      });
      emit(res, opts.json);
    });

  devices
    .command("update [deviceId]")
    .description(
      "PATCH /devices/:deviceId with a custom `state.desired` payload (raw JSON or key=value pairs)",
    )
    .option("--desired <json>", "Full JSON object to use as state.desired")
    .option(
      "--set <pair...>",
      "Repeatable key=value entries merged into state.desired (values parsed as JSON when possible)",
    )
    .option("--json", "Emit JSON")
    .action(
      async (
        deviceId: string | undefined,
        opts: { desired?: string; set?: string[]; json?: boolean },
      ) => {
        const desired: Record<string, unknown> = opts.desired ? JSON.parse(opts.desired) : {};
        for (const pair of opts.set ?? []) {
          const idx = pair.indexOf("=");
          if (idx < 0) throw new Error(`--set expects key=value, got: ${pair}`);
          const k = pair.slice(0, idx);
          const v = pair.slice(idx + 1);
          desired[k] = tryJson(v);
        }
        if (Object.keys(desired).length === 0) {
          throw new Error("update requires --desired <json> or one or more --set key=value");
        }
        const res = await patchDesired(resolveDeviceId(deviceId), desired);
        emit(res, opts.json);
      },
    );

  const cmd = devices
    .command("cmd <arg1> [arg2]")
    .description(
      "Send a device command (PATCH state.desired.deviceCommands). " +
        `Allowed commands: ${DEVICE_COMMANDS.join(", ")}.`,
    )
    .option("--json", "Emit JSON")
    .option("-y, --yes", "Skip the confirmation prompt")
    .addHelpText(
      "after",
      "\nUsage:\n" +
        "  boum devices cmd <deviceId> <command>\n" +
        "  boum devices cmd <command>            (uses defaultDeviceId)",
    )
    .action(async (arg1: string, arg2: string | undefined, opts: { json?: boolean; yes?: boolean }) => {
      // One arg is the command (device from config); two args are deviceId + command.
      const command = arg2 ?? arg1;
      if (!DEVICE_COMMANDS.includes(command)) {
        throw new Error(
          `unknown command '${command}'. Allowed: ${DEVICE_COMMANDS.join(", ")}`,
        );
      }
      const deviceId = arg2 !== undefined ? arg1 : resolveDeviceId(undefined);
      const warning =
        command === "resetWiFiCredentials"
          ? `resetWiFiCredentials clears Wi-Fi on device ${deviceId} — it must then ` +
            "be re-provisioned in person."
          : command === "restartDevice"
            ? `restartDevice reboots device ${deviceId}.`
            : null;
      if (warning) {
        await confirmOrAbort(`${warning} Continue?`, opts.yes);
      }
      const res = await patchDesired(deviceId, { deviceCommands: [command] });
      emit(res, opts.json);
    });
  void cmd;

  devices
    .command("pump <arg1> [arg2]")
    .description("Turn the pump on or off (PATCH state.desired.pumpState)")
    .option("--json", "Emit JSON")
    .option("-y, --yes", "Skip the confirmation prompt")
    .addHelpText(
      "after",
      "\nUsage:\n" +
        "  boum devices pump <deviceId> on|off\n" +
        "  boum devices pump on|off            (uses defaultDeviceId)",
    )
    .action(async (arg1: string, arg2: string | undefined, opts: { json?: boolean; yes?: boolean }) => {
      // One arg is the state (device from config); two args are deviceId + state.
      const state = arg2 ?? arg1;
      if (state !== "on" && state !== "off") {
        throw new Error("pump state must be 'on' or 'off'");
      }
      const deviceId = arg2 !== undefined ? arg1 : resolveDeviceId(undefined);
      if (state === "on") {
        await confirmOrAbort(`Turn the pump ON for device ${deviceId}?`, opts.yes);
      }
      const res = await patchDesired(deviceId, { pumpState: state });
      emit(res, opts.json);
    });

  devices
    .command("refill [deviceId]")
    .description("Configure the daily refill schedule (PATCH state.desired.dailyRefill* / refillTime*)")
    .option("--slot <n>", "Refill slot: 1, 2, 3, or omit for base dailyRefill", (v) => v)
    .option("--enabled <on|off>", "Enable/disable the slot")
    .option("--time <HH:MM>", "Refill time (HH:MM)")
    .option("--json", "Emit JSON")
    .action(
      async (
        deviceId: string | undefined,
        opts: {
          slot?: string;
          enabled?: string;
          time?: string;
          json?: boolean;
        },
      ) => {
        const desired: Record<string, unknown> = {};
        const slot = opts.slot;
        if (opts.enabled) {
          if (opts.enabled !== "on" && opts.enabled !== "off") {
            throw new Error("--enabled must be 'on' or 'off'");
          }
          const key =
            !slot || slot === "1"
              ? "dailyRefill"
              : slot === "2"
                ? "dailyRefillTwo"
                : slot === "3"
                  ? "dailyRefillThree"
                  : null;
          if (!key) throw new Error("--slot must be 1, 2, or 3");
          desired[key] = opts.enabled;
        }
        if (opts.time) {
          const key =
            !slot || slot === "1"
              ? "refillTimeOne"
              : slot === "2"
                ? "refillTimeTwo"
                : slot === "3"
                  ? "refillTimeThree"
                  : null;
          if (!key) throw new Error("--slot must be 1, 2, or 3");
          desired[key] = opts.time;
        }
        if (Object.keys(desired).length === 0) {
          throw new Error("refill needs at least one of --enabled, --time");
        }
        const res = await patchDesired(resolveDeviceId(deviceId), desired);
        emit(res, opts.json);
      },
    );

  devices
    .command("tune [deviceId]")
    .description(
      "Tune device behaviour via state.desired: pump/measurement limits, " +
        "refill interval, leak detection, flow rate",
    )
    .option("--max-pump-duration <Nmin>", "Max pump run time per refill, in minutes, e.g. '40min'")
    .option("--refill-interval <Ndays>", "Time between refills, in days, e.g. '7days'")
    .option("--max-pub-interval <Ns>", "Max time between measurements at <90% battery, in seconds, e.g. '60s'")
    .option("--h-max-pub-interval <Ns>", "Max time between measurements at >90% battery, in seconds, e.g. '90s'")
    .option("--leakage-detection <on|off>", "Enable or disable leak detection")
    .option("--min-flow-rate <number>", "Minimum flow rate, e.g. '0.11'")
    .option("--json", "Emit JSON")
    .action(
      async (
        deviceId: string | undefined,
        opts: {
          maxPumpDuration?: string;
          refillInterval?: string;
          maxPubInterval?: string;
          hMaxPubInterval?: string;
          leakageDetection?: string;
          minFlowRate?: string;
          json?: boolean;
        },
      ) => {
        const desired: Record<string, unknown> = {};
        if (opts.maxPumpDuration) {
          desired["maxPumpDuration"] = assertDuration(opts.maxPumpDuration, "--max-pump-duration", "min");
        }
        if (opts.refillInterval) {
          desired["refillInterval"] = assertDuration(opts.refillInterval, "--refill-interval", "days");
        }
        if (opts.maxPubInterval) {
          desired["maxPubInterval"] = assertDuration(opts.maxPubInterval, "--max-pub-interval", "s");
        }
        if (opts.hMaxPubInterval) {
          desired["hMaxPubInterval"] = assertDuration(opts.hMaxPubInterval, "--h-max-pub-interval", "s");
        }
        if (opts.leakageDetection) {
          if (opts.leakageDetection !== "on" && opts.leakageDetection !== "off") {
            throw new Error("--leakage-detection must be 'on' or 'off'");
          }
          desired["leakageDetection"] = opts.leakageDetection;
        }
        if (opts.minFlowRate !== undefined) {
          const n = Number(opts.minFlowRate);
          if (!Number.isFinite(n)) {
            throw new Error(`--min-flow-rate must be a number, got: ${opts.minFlowRate}`);
          }
          desired["minFlowRate"] = n;
        }
        if (Object.keys(desired).length === 0) {
          throw new Error(
            "tune needs at least one of --max-pump-duration, --refill-interval, " +
              "--max-pub-interval, --h-max-pub-interval, --leakage-detection, --min-flow-rate",
          );
        }
        const res = await patchDesired(resolveDeviceId(deviceId), desired);
        emit(res, opts.json);
      },
    );

}

function tryJson(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/**
 * Validate a device duration value against its fixed unit — the server accepts
 * a specific unit per parameter (`min`, `days` or `s`). Whitespace is stripped;
 * the normalised value is returned.
 */
function assertDuration(value: string, flag: string, unit: "s" | "min" | "days"): string {
  const v = value.replace(/\s+/g, "");
  if (!new RegExp(`^\\d+${unit}$`).test(v)) {
    throw new Error(`${flag} expects digits followed by '${unit}', e.g. '5${unit}', got: ${value}`);
  }
  return v;
}

/**
 * Prompt for a yes/no confirmation before a destructive action. Returns when
 * the user confirms or `skip` is set; throws to abort otherwise.
 */
async function confirmOrAbort(question: string, skip: boolean | undefined): Promise<void> {
  if (skip) return;
  const answer = (await prompt(`${question} [y/N] `)).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    throw new Error("aborted");
  }
}
