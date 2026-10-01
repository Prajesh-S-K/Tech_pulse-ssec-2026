// Firebase Admin gateway: token verification + Firestore handle. Credentials
// stay on the server; nothing here is ever sent to the client or logged.
import { readFileSync } from "node:fs";
import { initializeApp, cert, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let seq = 0;
export function createFirebaseGateway({
  projectId,
  serviceAccountPath,
  emulator = false,
}) {
  const options = { projectId };
  if (!emulator)
    options.credential = cert(
      JSON.parse(readFileSync(serviceAccountPath, "utf8")),
    );
  const app = initializeApp(options, `tech-pulse-${process.pid}-${seq++}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return {
    app,
    auth,
    db,
    verifyIdToken: (idToken) => auth.verifyIdToken(idToken, true),
    close: () => deleteApp(app),
  };
}
