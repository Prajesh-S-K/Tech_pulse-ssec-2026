// Firebase identities remain per-tab. Only exchanged server tokens call our API.
import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  setPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
let auth;
export async function configureFirebase(web, authEmulatorUrl) {
  auth = getAuth(initializeApp(web));
  if (authEmulatorUrl)
    connectAuthEmulator(auth, authEmulatorUrl, { disableWarnings: true });
  await setPersistence(auth, browserSessionPersistence);
  await auth.authStateReady();
}
export async function firebaseLogin(email, password, register = false) {
  if (!auth) throw Error("Firebase configuration is unavailable.");
  const result = await (
    register ? createUserWithEmailAndPassword : signInWithEmailAndPassword
  )(auth, email, password);
  return result.user.getIdToken();
}
export async function freshIdToken() {
  if (!auth?.currentUser) return null;
  return auth.currentUser.getIdToken(true);
}
export async function firebaseLogout() {
  if (auth) await signOut(auth);
}
