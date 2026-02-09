// /assets/js/firebase-init.js
// Central Firebase bootstrap for Dream School Academy
//
// Goals:
// - Initialize Firebase exactly once (safe across multiple imports).
// - Export shared auth + firestore instances.
// - Guarantee auth persistence is set early (authReady).
// - Provide a single GoogleAuthProvider instance.
// - Provide lightweight, actionable diagnostics (helps when Progress doesn't log).

import {
  initializeApp,
  getApps,
  getApp,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* -----------------------------
   Firebase config (must match Firebase Console)
------------------------------ */

const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
  authDomain: "dream-school-academy.firebaseapp.com",
  projectId: "dream-school-academy",
  storageBucket: "dream-school-academy.firebasestorage.app",
  messagingSenderId: "665412130733",
  appId: "1:665412130733:web:c3d59ab2c20f65a2277324",
  measurementId: "G-HCJWBWZXKZ",
};

/* -----------------------------
   Init exactly once
------------------------------ */

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/* -----------------------------
   Shared instances
------------------------------ */

const auth = getAuth(app);
const db = getFirestore(app);

/* -----------------------------
   Providers
------------------------------ */

const googleProvider = new GoogleAuthProvider();
// If you prefer silent reuse, remove this line.
googleProvider.setCustomParameters({ prompt: "select_account" });

/* -----------------------------
   Auth persistence (critical for "Progress not logging" issues)
------------------------------ */

const authReady = (async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    console.error("firebase-init: failed to set auth persistence:", e);
    // Continue anyway; Firebase will still work, but persistence may fall back.
  }

  // Wait until Firebase resolves the initial auth state once.
  // This avoids pages querying auth.currentUser before it's settled.
  await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, () => {
      unsub();
      resolve();
    });
  });
})();

/* -----------------------------
   Firestore offline persistence (safe best-effort)
------------------------------ */

const firestoreReady = (async () => {
  try {
    // This can throw if multiple tabs open, or if unsupported.
    await enableIndexedDbPersistence(db);
  } catch (e) {
    // Common and non-fatal:
    // - failed-precondition (multiple tabs)
    // - unimplemented (browser doesn't support)
    const code = String(e?.code || "");
    if (code && code !== "failed-precondition" && code !== "unimplemented") {
      console.warn("firebase-init: Firestore persistence warning:", e);
    }
  }
})();

/* -----------------------------
   Lightweight diagnostics (only on localhost)
------------------------------ */

const isLocalhost =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.hostname.endsWith(".local");

if (isLocalhost) {
  Promise.allSettled([authReady, firestoreReady]).then(() => {
    const u = auth.currentUser;
    console.log("firebase-init: OK", {
      projectId: firebaseConfig.projectId,
      authDomain: firebaseConfig.authDomain,
      user: u ? { uid: u.uid, email: u.email } : null,
    });
  });
}

export { app, auth, db, googleProvider, authReady, firestoreReady };
