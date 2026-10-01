import { mkdirSync, copyFileSync } from "node:fs";
import { requireNode, p, readJson, run } from "./lib/common.js";
requireNode();
const project = readJson(p(".firebaserc"))?.projects?.default;
if (project !== "tech-pulse-ssec") throw Error("Unexpected Hosting project.");
mkdirSync(p("dist-web"), { recursive: true });
copyFileSync(p("showcase", "index.html"), p("dist-web", "index.html"));
if (!process.argv.includes("--confirm")) {
  console.log(
    "Static showcase built in dist-web/. Nothing deployed. After reviewing it and confirming Spark in Console, run npm run deploy:web -- --confirm. Requires firebase login.",
  );
  process.exit(0);
}
const r = run(
  p("node_modules", ".bin", "firebase"),
  ["deploy", "--project", project, "--only", "hosting"],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
