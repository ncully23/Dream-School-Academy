// /assets/shell.js (ES module)
// 1) Inject header/footer
// 2) Highlight active nav
// 3) Hook Firebase Auth + Firestore for greeting and auth buttons

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
  authDomain: "dream-school-academy.firebaseapp.com",
  projectId: "dream-school-academy",
  storageBucket: "dream-school-academy.firebasestorage.app",
  messagingSenderId: "665412130733",
  appId: "1:665412130733:web:fc73f3ed574ffb6d277324",
  measurementId: "G-7LY2V2HQ4G"
};

// Init Firebase once
const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// Simple helpers
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function ensureMount(id, where = "start") {
  if (!document.getElementById(id)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.insertAdjacentElement(where === "start" ? "afterbegin" : "beforeend", el);
  }
}

function showState(signedIn) {
  $$("[data-when=\"signed-in\"]").forEach(el => {
    el.style.display = signedIn ? "" : "none";
  });
  $$("[data-when=\"signed-out\"]").forEach(el => {
    el.style.display = signedIn ? "none" : "";
  });
}

const deriveFromEmail = (email) =>
  (email || "")
    .split("@")[0]
    .split(/[._-]/)[0]
    .replace(/^\w/, c => c.toUpperCase()) || "there";

function renderGreeting(name) {
  const el = $("#greeting-name");
  if (el) el.textContent = name || "there";
}

async function getFirstName(user) {
  if (!user) return null;

  // 1) Try Firestore profile: users/{uid}.name
  try {
    const ref  = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      if (data && data.name) {
        return String(data.name).split(/\s+/)[0];
      }
    }
  } catch (e) {
    console.warn("Failed to load profile from Firestore:", e);
  }

  // 2) Fallback to displayName
  if (user.displayName) {
    return user.displayName.trim().split(/\s+/)[0];
  }

  // 3) Fallback to email
  if (user.email) {
    return deriveFromEmail(user.email);
  }

  return "there";
}

async function injectChrome() {
  // ---------- 1) Ensure header/footer mount points ----------
  ensureMount("site-header", "start");
  ensureMount("site-footer", "end");

  // ---------- 2) Inject header + footer ----------
  try {
    const [header, footer] = await Promise.all([
      fetch("/assets/header.html", { cache: "no-store" }).then(r => r.text()),
      fetch("/assets/footer.html", { cache: "no-store" }).then(r => r.text()),
    ]);
    $("#site-header").innerHTML = header;
    $("#site-footer").innerHTML = footer;
  } catch (e) {
    console.error("Header/footer inject failed:", e);
  }

  // ---------- 3) Highlight active nav ----------
  try {
    const page = document.documentElement.getAttribute("data-page"); // e.g. "home"
    const map = {
      "/": "home",
      "/index.html": "home",
      "/study.html": "study",
      "/practice.html": "practice",
      "/pricing.html": "pricing",
      "/contactus.html": "contact",
      "/login.html": "login",
    };
    const key = page || map[(location.pathname || "/").toLowerCase()];
    if (key) {
      $$(".site-nav a[data-nav]").forEach(a => {
        a.classList.toggle("active", a.getAttribute("data-nav") === key);
      });
    }
  } catch (e) {
    console.warn("Nav highlight failed:", e);
  }

  // ---------- 4) Auth greeting + sign out ----------
  try {
    // Guard: only proceed if header exists (after inject)
    if (!$(".site-header")) return;

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        let first = localStorage.getItem("dsa:firstName");
        if (!first) {
          first = await getFirstName(user);
          localStorage.setItem("dsa:firstName", first);
        }
        renderGreeting(first);
        showState(true);
      } else {
        renderGreeting("there");
        showState(false);
        localStorage.removeItem("dsa:firstName");
      }
    });

    // Sign out button/link (in header.html)
    $("#signout-link")?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await signOut(auth);
      } catch (e2) {
        console.warn("Sign out failed:", e2);
      }
      localStorage.removeItem("dsa:firstName");
      location.href = "/";
    });
  } catch (e) {
    console.warn("Auth greeting init failed:", e);
  }
}

// Run once per page load
injectChrome();
