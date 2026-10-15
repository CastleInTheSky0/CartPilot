import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

export function validBridgeEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const hash = (input: string) => createHash("sha1").update(input).digest("hex").slice(0, 8);
  const user = hash(process.env.USERNAME || process.env.USER || "default");
  if (process.platform === "win32") {
    const suffix = process.env.PWTEST_SOCKETS_DIR ? `-${hash(process.env.PWTEST_SOCKETS_DIR)}` : "";
    const prefix = `\\\\.\\pipe\\pw-${user}-browser-browser@`;
    if (value.startsWith(prefix) && value.endsWith(suffix)) {
      const id = value.slice(prefix.length, suffix ? -suffix.length : undefined);
      if (/^[a-f0-9]{6}$/.test(id)) return true;
    }
  } else {
    const directory = path.join(
      process.env.PWTEST_SOCKETS_DIR || path.join(tmpdir(), `pw-${user}`),
      "browser",
    );
    if (
      path.dirname(value) === directory &&
      /^browser-[a-f0-9]{6}\.sock$/.test(path.basename(value))
    )
      return true;
  }
  try {
    const endpoint = new URL(value);
    return (
      endpoint.protocol === "ws:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) &&
      !!endpoint.port &&
      !endpoint.username &&
      !endpoint.password
    );
  } catch {
    return false;
  }
}
