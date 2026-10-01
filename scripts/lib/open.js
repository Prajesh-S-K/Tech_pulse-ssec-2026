// Open a file or URL with the system default application. Silent no-op when
// TP_NO_OPEN is set (tests, servers) or when nothing can open it.
import { spawn } from "node:child_process";

export function openTarget(target) {
  if (process.env.TP_NO_OPEN) return false;
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
