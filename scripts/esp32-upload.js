// `npm run esp32:upload [-- /dev/cu.PORT] [--dry-run]`
// Stages are reported separately: discovery, port check, chip verification,
// compile, flash. Discovery is not verification and verification is not flashing.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { requireNode, run, p } from "./lib/common.js";
import { candidates, checkPort, verifyChip, fqbn } from "./lib/serial.js";

requireNode();
const dry = process.argv.includes("--dry-run");
const stage = (n, label, result) => console.log(`[${n}/5] ${label}: ${result}`);
try {
  let port = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const found = candidates();
  stage(
    1,
    "Discovery",
    port
      ? `using ${port}`
      : found.length
        ? found.join(", ")
        : "no USB-serial candidates",
  );
  if (!port && found.length === 1) port = found[0];
  if (!port) {
    if (!found.length)
      throw Error(
        "No ESP32 serial port found. Connect the board with a data USB cable.",
      );
    if (!stdin.isTTY)
      throw Error(
        "Several candidates; pass one explicitly: npm run esp32:upload -- /dev/cu.PORT",
      );
    const rl = createInterface({ input: stdin, output: stdout });
    port = (await rl.question(`Serial port (${found.join(", ")}): `)).trim();
    rl.close();
  }
  checkPort(port);
  stage(2, "Port free", `${port} is not in use`);
  if (dry) {
    stage(3, "Chip verification", "not run (dry run)");
    stage(4, "Compile", "not run (dry run)");
    stage(5, "Flash", "not run (dry run)");
    console.log(
      `Dry run only. Target FQBN would be ${fqbn}. Nothing was probed, compiled or written.`,
    );
    process.exit(0);
  }
  const chip = verifyChip(port);
  stage(
    3,
    "Chip verification",
    `${chip.chip}${chip.flashMB ? `, ${chip.flashMB}MB flash` : ""} (read-only)`,
  );
  const prep = run(process.execPath, [p("scripts", "prepare-companion.js")], {
    stdio: "inherit",
  });
  if (prep.status !== 0)
    throw Error("Firmware configuration could not be prepared.");
  // compile-companion re-verifies the chip before writing, so no alias can skip it.
  const r = run(
    process.execPath,
    [p("scripts", "compile-companion.js"), "--upload", port],
    {
      stdio: "inherit",
    },
  );
  stage(4, "Compile", r.status === 0 ? "ok" : "see output above");
  stage(
    5,
    "Flash",
    r.status === 0 ? "done — confirm serial readiness next" : "not completed",
  );
  process.exit(r.status ?? 1);
} catch (e) {
  console.error(`esp32:upload stopped: ${e.message}`);
  process.exitCode = 1;
}
