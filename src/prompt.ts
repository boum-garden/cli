import * as readline from "readline";

export function prompt(
  question: string,
  opts: { hidden?: boolean; default?: string } = {},
): Promise<string> {
  if (!opts.hidden) {
    const hasDefault = opts.default !== undefined && opts.default !== "";
    const q = hasDefault ? `${question.replace(/:\s*$/, "")} [${opts.default}]: ` : question;
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      rl.question(q, (answer) => {
        rl.close();
        resolve(answer.trim() === "" && hasDefault ? opts.default! : answer);
      });
    });
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const isTTY = Boolean(stdin.isTTY);
    const wasRaw = isTTY ? stdin.isRaw : false;
    process.stderr.write(question);
    let value = "";
    if (isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const finish = (err: Error | null, result?: string) => {
      if (isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
      if (err) reject(err);
      else resolve(result ?? "");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (ch === "\n" || ch === "\r" || code === 4) {
          return finish(null, value);
        }
        if (code === 3) {
          finish(new Error("Aborted"));
          process.exit(130);
          return;
        }
        if (code === 127 || code === 8) {
          value = value.slice(0, -1);
        } else if (code >= 32) {
          value += ch;
        }
      }
    };
    stdin.on("data", onData);
  });
}
