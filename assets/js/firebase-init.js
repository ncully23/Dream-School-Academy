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
// This uses a singleton pattern to prevent Firebase from being initialized multiple times
// If an app already exists (getApps().length > 0), reuse it with getApp()
// Otherwise, initialize a new Firebase app with your config

const app = getApps().length
  ? getApp() // reuse existing Firebase instance
  : initializeApp(firebaseConfig); // create new Firebase instance

/* -----------------------------
   Shared instances
------------------------------ */

// These create the main service controllers for your app
// auth → handles login, logout, and current user state
// db → handles all Firestore database reads/writes

const auth = getAuth(app);
const db = getFirestore(app);

/* -----------------------------
   Providers
------------------------------ */

// GoogleAuthProvider enables users to sign in with their Google account
const googleProvider = new GoogleAuthProvider();

// This forces the Google login screen to always ask which account to use
// Remove this line if you want Firebase to silently reuse the last account
googleProvider.setCustomParameters({ prompt: "select_account" });

/* -----------------------------
   Auth persistence (critical for "Progress not logging" issues)
------------------------------ */

// authReady is a Promise that ensures authentication is fully initialized
// before the rest of your app tries to use auth.currentUser

const authReady = (async () => {
  try {
    // This tells Firebase to store login state in the browser (localStorage)
    // Result: user stays logged in after refresh or reopening the site
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    console.error("firebase-init: failed to set auth persistence:", e);
    // Even if this fails, Firebase still works (just without guaranteed persistence)
  }

  // Firebase does NOT immediately know if a user is logged in on page load
  // This waits until Firebase finishes checking and fires the first auth state event
  await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, () => {
      unsub(); // stop listening after first event (only need initial state)
      resolve(); // signal that auth is now ready
    });
  });
})();

/* -----------------------------
   Firestore offline persistence (safe best-effort)
------------------------------ */

// firestoreReady attempts to enable IndexedDB caching for Firestore
// This improves performance and allows limited offline usage

const firestoreReady = (async () => {
  try {
    // Enables local caching of Firestore data in the browser
    await enableIndexedDbPersistence(db);
  } catch (e) {
    // This commonly fails in normal situations:
    // - Multiple tabs open (failed-precondition)
    // - Browser does not support IndexedDB (unimplemented)
    const code = String(e?.code || "");

    // Only warn if it's an unexpected error
    if (code && code !== "failed-precondition" && code !== "unimplemented") {
      console.warn("firebase-init: Firestore persistence warning:", e);
    }
  }
})();

/* -----------------------------
   Lightweight diagnostics (only on localhost)
------------------------------ */

// Detect if the app is running locally (development environment)
const isLocalhost =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.hostname.endsWith(".local");

if (isLocalhost) {
  // Wait for both auth and Firestore setup to finish (success or failure)
  Promise.allSettled([authReady, firestoreReady]).then(() => {
    const u = auth.currentUser;

    // Log useful debug info to confirm Firebase is working correctly
    console.log("firebase-init: OK", {
      projectId: firebaseConfig.projectId,
      authDomain: firebaseConfig.authDomain,
      user: u ? { uid: u.uid, email: u.email } : null, // show logged-in user if exists
    });
  });
}

// Export shared Firebase instances and readiness Promises
// Other files can import these instead of re-initializing Firebase
export { app, auth, db, googleProvider, authReady, firestoreReady };
