import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyChip, arduinoCli, fqbn as defaultFqbn } from "./lib/serial.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = arduinoCli();
const fqbn = defaultFqbn;
if (!existsSync(join(root, "firmware/TECH_PULSE_COMPANION/config.h")))
  throw Error("Run npm run esp32:prepare first.");
const build = join(root, "firmware/build");
mkdirSync(build, { recursive: true });
const args = ["compile", "--fqbn", fqbn, "--build-path", build];
// All firmware functions are explicitly defined before use, so Arduino prototype generation is unnecessary.
// This avoids the old Intel-only bundled ctags on Apple Silicon without modifying the installed tools.
if (process.platform === "darwin" && process.arch === "arm64")
  args.push("--build-property", "tools.ctags.cmd.path=/usr/bin/true");
args.push(join(root, "firmware/TECH_PULSE_COMPANION"));
const compile = spawnSync(cli, args, { stdio: "inherit" });
if (compile.error) throw compile.error;
if (compile.status !== 0) process.exit(compile.status || 1);
const i = process.argv.indexOf("--upload");
if (i >= 0) {
  const port = process.argv[i + 1];
  if (!port || port.startsWith("--"))
    throw Error("Specify a serial port after --upload.");
  // Every upload path (esp32:upload and the explicit-port alias) verifies the chip first.
  const chip = verifyChip(port);
  console.log(`Chip verified (read-only): ${chip.chip}`);
  const upload = spawnSync(
    cli,
    [
      "upload",
      "--fqbn",
      fqbn,
      "--port",
      port,
      "--input-dir",
      build,
      join(root, "firmware/TECH_PULSE_COMPANION"),
    ],
    { stdio: "inherit" },
  );
  if (upload.error) throw upload.error;
  process.exit(upload.status || 0);
}
