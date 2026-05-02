// /assets/js/firebase-init.js
// Central Firebase bootstrap for Dream School Academy
//
// Goals:
// - Initialize Firebase exactly once (safe across multiple imports).
// - Export shared auth + firestore instances.
// - Guarantee auth persistence is set early (authReady).
// - Provide a single GoogleAuthProvider instance.
// - Provide lightweight, actionable diagnostics (helps when Progress doesn't log).





import { // // ES module import to bring i3 functions from the Firebase SDK hosted at a Google URL
// Here, we use the CDN Method to build a simple browser-based app or prototypes where you want quick setup with no build tools
// Download/install Firebase locally (via npm) when using frameworks like Next.js/React or when you need bundling, version control, and better performance optimization
  initializeApp, // initializes a Firebase application using your project’s configuration
  getApps, // returns a list of all Firebase apps that have already been initialized in the current page
  getApp, // retrieves an existing initialized app
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";


import { // pulls in the core Firebase Authentication tools your app needs to handle user login and session management
  getAuth, // creates the main authentication controller
  setPersistence,
  browserLocalPersistence, // setPersistence and browserLocalPersistence ensure users stay logged in across refreshes
  GoogleAuthProvider, // enables Google sign-in
  onAuthStateChanged, // lets your app react when a user logs in or out
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";   // tells the browser exactly where to load the module from—here, a hosted Firebase Authentication file on Google’s CDN.
  // Instead of pulling code from your local project, it fetches this file over the internet and makes its exported functions available to your script.


import { // brings in the Firestore database tools from Firebase’s hosted SDK & allows your app to connect to and use the database
  getFirestore, // creates the main database instance
  enableIndexedDbPersistence, // turns on local browser storage so data can be cached and accessed offline or more quickly
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* -----------------------------
   Firebase config (must match Firebase Console)
------------------------------ */

// This firebaseConfig object is the configuration bundle that connects your app to a specific Firebase project
// act as the identifier Firebase uses to route all authentication, database, and storage requests correctly.
// When you call initializeApp(firebaseConfig), Firebase reads these fields to know which backend resources to use, ensuring your app talks to the correct project environment.


  const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE", // Public key used to identify and authorize your app when making requests to Firebase services.
  authDomain: "dream-school-academy.firebaseapp.com", // domain used for handling authentication flows like login redirects and OAuth callbacks.
  projectId: "dream-school-academy",  // unique identifier for your Firebase project, used to scope database and service access.
  storageBucket: "dream-school-academy.firebasestorage.app", // location for storing and retrieving files (e.g., images, uploads) in Firebase Storage.
  messagingSenderId: "665412130733", // Identifier used for Firebase Cloud Messaging (push notifications).
  appId: "1:665412130733:web:c3d59ab2c20f65a2277324", // Unique ID for this specific app instance within the Firebase project.
  measurementId: "G-HCJWBWZXKZ", // Identifier used for Google Analytics tracking and event measurement.
};

// Initialize exactly once

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
