import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { requireNode, runtimePath, readJson, p } from "./lib/common.js";
import { validateFirebaseConfig } from "../server/firebase/config.js";
requireNode();
const rl = createInterface({ input: stdin, output: stdout });
try {
  const old = readJson(runtimePath) || {};
  const mode =
    (await rl.question("Mode: local or firebase [local]: ")).trim() || "local";
  if (!["local", "firebase"].includes(mode))
    throw Error("Choose local or firebase.");
  const runtime = { ...old, mode };
  if (mode === "firebase") {
    console.log(
      "Enter PUBLIC web configuration only. Never paste your Admin private key here.",
    );
    const web = { ...old.firebase?.web, projectId: "tech-pulse-ssec" };
    for (const field of [
      "apiKey",
      "authDomain",
      "appId",
      "messagingSenderId",
      "storageBucket",
    ]) {
      const answer = (
        await rl.question(`${field}${web[field] ? " [saved]" : ""}: `)
      ).trim();
      if (answer) web[field] = answer;
    }
    const path =
      (
        await rl.question(
          "Admin JSON file path [private/firebase-service-account.json]: ",
        )
      ).trim() || "private/firebase-service-account.json";
    runtime.firebase = { web, serviceAccountPath: path };
    validateFirebaseConfig(runtime, p());
  }
  mkdirSync(p("private"), { recursive: true });
  writeFileSync(runtimePath, JSON.stringify(runtime, null, 2) + "\n", {
    mode: 0o600,
  });
  chmodSync(runtimePath, 0o600);
  console.log(
    "Saved private/runtime.json. Local: npm run demo. Connected: npm run demo:connected. Phones: npm run demo:phones.",
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  rl.close();
}
