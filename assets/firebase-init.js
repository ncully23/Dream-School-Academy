// /assets/firebase-init.js
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// REAL config (make sure this matches your Firebase console exactly)
const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
  authDomain: "dream-school-academy.firebaseapp.com",
  projectId: "dream-school-academy",
  storageBucket: "dream-school-academy.firebasestorage.app",
  messagingSenderId: "665412130733",
  appId: "1:665412130733:web:c3d59ab2c20f65a2277324",
  measurementId: "G-HCJWBWZXKZ"
};

// Initialize exactly once, even if imported multiple times
const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Keep users signed in (no top-level await)
setPersistence(auth, browserLocalPersistence).catch(console.error);

// Optional debug
console.log("Firebase init OK:", firebaseConfig.projectId);

// Export shared instances for use everywhere
export { app, auth, db, googleProvider };
