import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type Env = "dev" | "prod" | "local";

export interface Config {
  env: Env;
  baseUrlOverride?: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  defaultDeviceId?: string;
}

const DEFAULT_CONFIG: Config = { env: "prod" };

const BASE_URLS: Record<Env, string> = {
  prod: "https://api.boum.us/v1",
  dev: "https://api-dev.boum.us/v1",
  local: "http://localhost:3000/dev/v1",
};

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "boum");
}

function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): Config {
  const p = configPath();
  if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    throw new Error(`Failed to read config at ${p}: ${(err as Error).message}`);
  }
}

export function saveConfig(cfg: Config): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = configPath();
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function updateConfig(patch: Partial<Config>): Config {
  const cfg = { ...loadConfig(), ...patch };
  saveConfig(cfg);
  return cfg;
}

export function baseUrlFor(cfg: Config, envOverride?: Env): string {
  if (cfg.baseUrlOverride && !envOverride) return cfg.baseUrlOverride;
  const env = envOverride ?? cfg.env;
  return BASE_URLS[env];
}

export function configFilePath(): string {
  return configPath();
}

export function knownEnvs(): Env[] {
  return ["dev", "prod", "local"];
}
