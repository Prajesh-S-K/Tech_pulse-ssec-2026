import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { requireNode, readJson, runtimePath, p } from "./lib/common.js";
import { validateFirebaseConfig } from "../server/firebase/config.js";
import { createFirebaseGateway } from "../server/firebase/admin.js";
requireNode();
let gateway;
const rl = createInterface({ input: stdin, output: stdout });
try {
  const runtime = readJson(runtimePath);
  if (!runtime || runtime.mode !== "firebase")
    throw Error("Run npm run setup and choose firebase first.");
  gateway = createFirebaseGateway(validateFirebaseConfig(runtime, p()));
  const owners = await gateway.db
    .collection("users")
    .where("role", "==", "dev")
    .limit(1)
    .get();
  if (!owners.empty)
    console.log(
      "A developer owner already exists; no accounts or data changed.",
    );
  else {
    const email = (
      await rl.question(
        "Existing Firebase owner account email (create it in Console Authentication first): ",
      )
    ).trim();
    const user = await gateway.auth.getUserByEmail(email);
    if (user.disabled) throw Error("Owner account is disabled.");
    await gateway.db.runTransaction(async (tx) => {
      const ref = gateway.db.collection("users").doc(user.uid);
      const current = await tx.get(ref);
      if (current.exists && current.data().role === "dev") return;
      tx.set(
        ref,
        {
          id: user.uid,
          name: user.displayName || "Project owner",
          email: user.email,
          role: "dev",
          createdAt: Date.now(),
        },
        { merge: true },
      );
    });
    console.log(
      "Owner provisioned with developer permissions. Sign in with that Firebase account; create venues/courses in the portal. No local data uploaded.",
    );
  }
} catch {
  console.error(
    "Owner initialization failed. Check runtime configuration, Admin key, enabled Auth/Firestore and the existing owner email. No credentials printed.",
  );
  process.exitCode = 1;
} finally {
  rl.close();
  if (gateway) await gateway.close();
}
