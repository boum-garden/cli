#!/usr/bin/env node
import { Command } from "commander";
import { Env, knownEnvs, updateConfig } from "./config";
import { HttpError } from "./http";
import { printErr } from "./output";
import { registerAuthCommands } from "./commands/auth";
import { registerConfigCommands } from "./commands/config";
import { registerDataCommands } from "./commands/data";
import { registerDeviceCommands } from "./commands/devices";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("boum")
  .description("CLI for the Boum IoT REST API")
  .version(VERSION)
  .option(
    "-e, --env <env>",
    `API environment (one of: ${knownEnvs().join(", ")}); persisted for future calls`,
  )
  .hook("preAction", (thisCmd) => {
    const opts = thisCmd.opts<{ env?: string }>();
    if (opts.env) {
      if (!knownEnvs().includes(opts.env as Env)) {
        printErr(`--env must be one of: ${knownEnvs().join(", ")}`);
        process.exit(2);
      }
      updateConfig({ env: opts.env as Env });
    }
  });

registerAuthCommands(program);
registerDeviceCommands(program);
registerDataCommands(program);
registerConfigCommands(program);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof HttpError) {
      printErr(`${err.status} ${err.statusText}`);
      const parsed = err.parsedBody();
      if (typeof parsed === "string") {
        if (parsed.length > 0) process.stderr.write(parsed + "\n");
      } else {
        process.stderr.write(JSON.stringify(parsed, null, 2) + "\n");
      }
      process.exit(1);
    }
    printErr((err as Error).message);
    process.exit(1);
  }
}

void main();
