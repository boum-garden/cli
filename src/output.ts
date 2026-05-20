const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const ansi = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const red = ansi("31");
export const green = ansi("32");
export const yellow = ansi("33");
export const blue = ansi("34");
export const dim = ansi("2");
export const bold = ansi("1");

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function printErr(msg: string): void {
  process.stderr.write(red("error: ") + msg + "\n");
}

export function printInfo(msg: string): void {
  process.stderr.write(dim(msg) + "\n");
}

/**
 * Render an array of flat-ish objects as a table. Falls back to JSON for
 * nested values.
 */
export function printTable(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    process.stdout.write(dim("(empty)") + "\n");
    return;
  }
  const cols = columns ?? collectColumns(rows);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => cellString(r[c]).length)),
  );
  const header = cols.map((c, i) => bold(pad(c, widths[i]!))).join("  ");
  process.stdout.write(header + "\n");
  process.stdout.write(cols.map((_, i) => "-".repeat(widths[i]!)).join("  ") + "\n");
  for (const r of rows) {
    const line = cols.map((c, i) => pad(cellString(r[c]), widths[i]!)).join("  ");
    process.stdout.write(line + "\n");
  }
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

function cellString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const ts = firestoreTimestamp(v);
  if (ts) return ts;
  return JSON.stringify(v);
}

/**
 * Render a Firestore Timestamp ({_seconds,_nanoseconds}, also accepting the
 * un-prefixed {seconds,nanoseconds} form) as an ISO date string. Returns null
 * for any other value.
 */
function firestoreTimestamp(v: unknown): string | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const seconds = typeof o._seconds === "number" ? o._seconds : o.seconds;
  const nanos = typeof o._nanoseconds === "number" ? o._nanoseconds : o.nanoseconds;
  if (typeof seconds !== "number" || typeof nanos !== "number") return null;
  return new Date(seconds * 1000 + nanos / 1e6).toISOString();
}

function pad(s: string, n: number): string {
  return s + " ".repeat(Math.max(0, n - visibleLength(s)));
}

function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
