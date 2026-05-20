import { Command } from "commander";
import { apiRequest, unwrap } from "../http";
import { loadConfig, updateConfig, saveConfig } from "../config";
import { printJson, printInfo } from "../output";
import { prompt } from "../prompt";

interface SigninResponse {
  accessToken: string;
  refreshToken: string;
  [k: string]: unknown;
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Sign in, manage tokens");

  auth
    .command("signin")
    .description("Sign in and store tokens (POST /auth/signin)")
    .option("-e, --email <email>", "Account email")
    .option("-p, --password <password>", "Account password")
    .option("--json", "Emit JSON")
    .action(async (opts: { email?: string; password?: string; json?: boolean }) => {
      const cfg = loadConfig();
      const email = opts.email ?? (await prompt("Email: ", { default: cfg.email }));
      const password = opts.password ?? (await prompt("Password: ", { hidden: true }));
      const res = await apiRequest<unknown>({
        method: "POST",
        path: "/auth/signin",
        body: { email, password },
      });
      const data = unwrap<SigninResponse>(res);
      if (!data?.accessToken || !data?.refreshToken) {
        throw new Error("Sign-in response missing tokens");
      }
      updateConfig({
        email,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      if (opts.json) printJson(res);
      else printInfo(`signed in as ${email} (env=${cfg.env})`);
    });

  auth
    .command("refresh")
    .description("Exchange refresh token for a new access token (POST /auth/token)")
    .option("--json", "Emit JSON")
    .action(async (opts: { json?: boolean }) => {
      const cfg = loadConfig();
      if (!cfg.refreshToken) {
        throw new Error("No refresh token stored. Run `boum auth signin`.");
      }
      const res = await apiRequest<unknown>({
        method: "POST",
        path: "/auth/token",
        body: { refreshToken: cfg.refreshToken },
      });
      const data = unwrap<{ accessToken: string; refreshToken?: string }>(res);
      if (!data?.accessToken) throw new Error("Token refresh response missing accessToken");
      updateConfig({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? cfg.refreshToken,
      });
      if (opts.json) printJson(res);
      else printInfo("access token refreshed");
    });

  auth
    .command("whoami")
    .description("Show the currently signed-in user (GET /users)")
    .option("--json", "Emit JSON")
    .action(async (opts: { json?: boolean }) => {
      const res = await apiRequest<unknown>({ path: "/users", auth: true });
      const data = unwrap<unknown>(res);
      if (opts.json) {
        printJson(data);
        return;
      }
      process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    });

  auth
    .command("logout")
    .description("Delete stored tokens from local config")
    .action(() => {
      const cfg = loadConfig();
      delete cfg.accessToken;
      delete cfg.refreshToken;
      delete cfg.email;
      saveConfig(cfg);
      printInfo("logged out (local tokens cleared)");
    });
}
