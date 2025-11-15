// /assets/shell.js (module)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

// Same config as your login page
const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
  authDomain: "dream-school-academy.firebaseapp.com",
  projectId: "dream-school-academy",
  storageBucket: "dream-school-academy.firebasestorage.app",
  messagingSenderId: "665412130733",
  appId: "1:665412130733:web:fc73f3ed574ffb6d277324",
  measurementId: "G-7LY2V2HQ4G"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// Inject a header into #site-header
const headerRoot = document.getElementById("site-header");
if (headerRoot) {
  headerRoot.innerHTML = `
    <header class="site-header">
      <div class="container nav">
        <a href="/" class="logo">Dream School Academy</a>
        <nav class="nav-right">
          <span id="user-greeting" class="nav-greeting"></span>
          <a href="/login.html" id="login-link" class="nav-btn">Log in / Sign up</a>
          <button id="logout-btn" class="nav-btn" style="display:none">Log out</button>
        </nav>
      </div>
    </header>
  `;
}

const greetingEl = document.getElementById("user-greeting");
const loginLink  = document.getElementById("login-link");
const logoutBtn  = document.getElementById("logout-btn");

// Logout handler
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "/"; // back to home as logged-out
    } catch (e) {
      console.error("Sign out failed:", e);
    }
  });
}

// Helper to get first name from Firestore or Auth
async function getFirstName(user) {
  if (!user) return null;

  // Try Firestore `users/{uid}` first
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      if (data.name) return String(data.name).split(" ")[0];
    }
  } catch (e) {
    console.warn("Failed to load profile:", e);
  }

  // Fallbacks
  if (user.displayName) return user.displayName.split(" ")[0];
  if (user.email) return user.email.split("@")[0];
  return "there";
}

// Watch auth state and update header
onAuthStateChanged(auth, async (user) => {
  if (!greetingEl || !loginLink || !logoutBtn) return;

  if (user) {
    const first = await getFirstName(user);
    greetingEl.textContent = `Hi, ${first}`;
    loginLink.style.display = "none";
    logoutBtn.style.display = "inline-flex";
  } else {
    greetingEl.textContent = "";
    loginLink.style.display = "inline-flex";
    logoutBtn.style.display = "none";
  }
});
