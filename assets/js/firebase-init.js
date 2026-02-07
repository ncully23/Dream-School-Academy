// /assets/firebase-init.js
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// Must match Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
  authDomain: "dream-school-academy.firebaseapp.com",
  projectId: "dream-school-academy",
  storageBucket: "dream-school-academy.firebasestorage.app",
  messagingSenderId: "665412130733",
  appId: "1:665412130733:web:c3d59ab2c20f65a2277324",
  measurementId: "G-HCJWBWZXKZ",
};

// Init exactly once (safe across multiple imports)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Shared instances
const auth = getAuth(app);
const db = getFirestore(app);

// Google provider (configure once)
const googleProvider = new GoogleAuthProvider();
// Optional: force account chooser each time (remove if you prefer silent reuse)
googleProvider.setCustomParameters({ prompt: "select_account" });

// Ensure persistence is applied before sign-in flows that depend on it
const authReady = setPersistence(auth, browserLocalPersistence).catch((e) => {
  console.error("firebase-init: failed to set auth persistence:", e);
  // Continue anyway; auth will still function, but persistence might fall back.
});

// Debug only on localhost
const isLocalhost =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.hostname.endsWith(".local");

if (isLocalhost) {
  console.log("firebase-init: OK", {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
  });
}

export { app, auth, db, googleProvider, authReady };
