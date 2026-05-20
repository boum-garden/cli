import { Config, Env, baseUrlFor, loadConfig, updateConfig } from "./config";

export interface RequestOptions {
  method?: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  auth?: boolean;
  envOverride?: Env;
  baseUrlOverride?: string;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly bodyText: string,
    public readonly url: string,
  ) {
    super(`HTTP ${status} ${statusText} on ${url}`);
  }

  parsedBody(): unknown {
    try {
      return JSON.parse(this.bodyText);
    } catch {
      return this.bodyText;
    }
  }
}

function buildUrl(base: string, p: string, query?: RequestOptions["query"]): string {
  const joined = base.replace(/\/+$/, "") + "/" + p.replace(/^\/+/, "");
  if (!query) return joined;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    usp.append(k, String(v));
  }
  const q = usp.toString();
  return q.length > 0 ? `${joined}?${q}` : joined;
}

async function doFetch(
  url: string,
  method: string,
  body: unknown,
  token: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = token;
  let payload: string | undefined;
  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  return fetch(url, { method, headers, body: payload });
}

async function refreshAccessToken(cfg: Config, envOverride?: Env): Promise<Config> {
  if (!cfg.refreshToken) {
    throw new Error("No refresh token stored. Run `boum auth signin`.");
  }
  const base = baseUrlFor(cfg, envOverride);
  const url = buildUrl(base, "/auth/token");
  const res = await doFetch(url, "POST", { refreshToken: cfg.refreshToken }, undefined);
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(res.status, res.statusText, text, url);
  }
  const parsed = JSON.parse(text) as { data?: { accessToken?: string; refreshToken?: string } };
  const newAccess = parsed.data?.accessToken;
  const newRefresh = parsed.data?.refreshToken;
  if (!newAccess) throw new Error("Token refresh response missing accessToken");
  return updateConfig({
    accessToken: newAccess,
    refreshToken: newRefresh ?? cfg.refreshToken,
  });
}

export async function apiRequest<T = unknown>(opts: RequestOptions): Promise<T> {
  let cfg = loadConfig();
  const method = (opts.method ?? "GET").toUpperCase();
  const base = opts.baseUrlOverride ?? baseUrlFor(cfg, opts.envOverride);
  const url = buildUrl(base, opts.path, opts.query);
  const needsAuth = opts.auth ?? false;

  if (needsAuth && !cfg.accessToken) {
    throw new Error("Not signed in. Run `boum auth signin` first.");
  }

  let res = await doFetch(url, method, opts.body, needsAuth ? cfg.accessToken : undefined);

  if (res.status === 401 && needsAuth && cfg.refreshToken) {
    cfg = await refreshAccessToken(cfg, opts.envOverride);
    res = await doFetch(url, method, opts.body, cfg.accessToken);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(res.status, res.statusText, text, url);
  }
  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/**
 * The Boum API wraps successful responses in `{ data: ... }`. Unwrap when
 * present so commands can work with the inner value.
 */
export function unwrap<T>(v: unknown): T {
  if (v && typeof v === "object" && "data" in (v as Record<string, unknown>)) {
    return (v as { data: T }).data;
  }
  return v as T;
}
