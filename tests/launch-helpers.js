import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

export const repo = new URL("../", import.meta.url).pathname;
export const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// A throwaway "project" with the real launcher but a stub server/build, so the
// launcher's control flow can be exercised without installing anything.
export function project({
  lock = true,
  stampDeps = true,
  stampBuild = true,
  server,
  build,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tp-launch-"));
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  mkdirSync(join(dir, "server"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  cpSync(join(repo, "scripts/demo.js"), join(dir, "scripts/demo.js"));
  cpSync(join(repo, "scripts/phones.js"), join(dir, "scripts/phones.js"));
  for (const f of ["common", "open", "logins", "certserver", "caddyfile"])
    cpSync(join(repo, `scripts/lib/${f}.js`), join(dir, `scripts/lib/${f}.js`));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "stub",
      type: "module",
      scripts: {
        build:
          build ||
          "node -e \"require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/index.html','x')\"",
      },
    }),
  );
  writeFileSync(join(dir, "index.html"), "<html></html>");
  writeFileSync(join(dir, "src/a.js"), "1");
  if (lock) writeFileSync(join(dir, "package-lock.json"), "{}");
  writeFileSync(join(dir, "server/index.js"), server || "process.exit(1)");
  return dir;
}
export function stamp(dir, { deps = true, build = true } = {}) {
  const probe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { recordDeps, recordBuild } from "./scripts/lib/common.js";
    import { mkdirSync, writeFileSync } from "node:fs";
    mkdirSync("node_modules", { recursive: true });
    mkdirSync("dist", { recursive: true });
    writeFileSync("dist/index.html", "x");
    ${deps ? "recordDeps();" : ""} ${build ? "recordBuild();" : ""}`,
    ],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(probe.status, 0, probe.stderr);
}
export const demo = (dir, env = {}, args = []) =>
  spawnSync(process.execPath, ["scripts/demo.js", ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30000,
    killSignal: "SIGKILL",
    env: { ...process.env, PORT: "0", ...env },
  });

export const listeningServer = `
import { createServer } from "node:http";
createServer((q, s) => { s.setHeader("content-type","application/json"); s.end('{"mode":"local"}'); })
  .listen(Number(process.env.PORT), "127.0.0.1", () => console.log("stub up"));
setInterval(() => {}, 1000);
process.on("SIGTERM", () => process.exit(0));`;
