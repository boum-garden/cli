import { Command } from "commander";
import {
  Config,
  Env,
  configFilePath,
  knownEnvs,
  loadConfig,
  saveConfig,
  updateConfig,
} from "../config";
import { printJson, printInfo, printErr } from "../output";

const REDACTED_KEYS = new Set(["accessToken", "refreshToken"]);

function redact(cfg: Config): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cfg };
  for (const k of REDACTED_KEYS) {
    const v = (cfg as unknown as Record<string, unknown>)[k];
    if (typeof v === "string" && v.length > 0) {
      out[k] = `${v.slice(0, 6)}…(${v.length} chars)`;
    }
  }
  return out;
}

export function registerConfigCommands(program: Command): void {
  const cfg = program.command("config").description("Manage CLI configuration");

  cfg
    .command("show")
    .description("Print current configuration (tokens redacted)")
    .option("--raw", "Show full tokens (sensitive)")
    .option("--json", "Emit JSON")
    .action((opts: { raw?: boolean; json?: boolean }) => {
      const c = loadConfig();
      const view = opts.raw ? (c as unknown as Record<string, unknown>) : redact(c);
      if (opts.json) {
        printJson(view);
        return;
      }
      process.stdout.write(`Config file: ${configFilePath()}\n`);
      for (const [k, v] of Object.entries(view)) {
        process.stdout.write(`  ${k} = ${JSON.stringify(v)}\n`);
      }
    });

  cfg
    .command("get <key>")
    .description("Get a single config value")
    .action((key: string) => {
      const c = loadConfig() as unknown as Record<string, unknown>;
      const v = c[key];
      if (v === undefined) process.exit(1);
      process.stdout.write((typeof v === "string" ? v : JSON.stringify(v)) + "\n");
    });

  cfg
    .command("set <key> <value>")
    .description(
      "Set a config value. Keys: env (dev|prod|local), baseUrlOverride, email, defaultDeviceId",
    )
    .action((key: string, value: string) => {
      const allowed = new Set([
        "env",
        "baseUrlOverride",
        "email",
        "defaultDeviceId",
        "accessToken",
        "refreshToken",
      ]);
      if (!allowed.has(key)) {
        printErr(`Unknown config key: ${key}. Allowed: ${[...allowed].join(", ")}`);
        process.exit(2);
      }
      if (key === "env" && !knownEnvs().includes(value as Env)) {
        printErr(`env must be one of: ${knownEnvs().join(", ")}`);
        process.exit(2);
      }
      const patch: Record<string, string> = { [key]: value };
      updateConfig(patch as Partial<Config>);
      printInfo(`set ${key}`);
    });

  cfg
    .command("unset <key>")
    .description("Remove a config value")
    .action((key: string) => {
      const c = loadConfig() as unknown as Record<string, unknown>;
      delete c[key];
      saveConfig(c as unknown as Config);
      printInfo(`unset ${key}`);
    });

  cfg
    .command("path")
    .description("Print the config file path")
    .action(() => {
      process.stdout.write(configFilePath() + "\n");
    });
}
