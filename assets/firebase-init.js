// /assets/firebase-init.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence, GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// REAL config (from your screenshots)
const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpG0jgLNt7w_R0tm_mWg_FZEYE",
  authDomain: "dream-school-academy.firebaseapp.com",
  projectId: "dream-school-academy",
  storageBucket: "dream-school-academy.firebasestorage.app",
  messagingSenderId: "665412130733",
  appId: "1:665412130733:web:c3d59ab2c20f65a2277324",
  measurementId: "G-HCJWBWZXKZ"
};

// Initialize exactly once, even if imported multiple times
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Keep users signed in
await setPersistence(auth, browserLocalPersistence);

// DEBUG so you can verify the right app is running:
console.log("Firebase init OK:",
  auth.config?.authDomain,
  "key:", (firebaseConfig.apiKey||"").slice(0,7)+"…"
);
