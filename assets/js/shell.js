// /assets/js/shell.js
// Injects shared header/footer, highlights active nav, and wires up auth UI.

// Use a relative import so this works from /assets/js/
import { auth, db } from "./firebase-init.js";

import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// Small DOM helpers
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Main shell initializer
async function initShell() {
  // 1) Ensure header/footer mount points exist
  function ensureMount(id, where = "start") {
    if (!document.getElementById(id)) {
      const el = document.createElement("div");
      el.id = id;
      if (!document.body) return;
      document.body.insertAdjacentElement(
        where === "start" ? "afterbegin" : "beforeend",
        el
      );
    }
  }

  ensureMount("site-header", "start");
  ensureMount("site-footer", "end");

  // 2) Inject header + footer HTML
  try {
    const [headerHtml, footerHtml] = await Promise.all([
      fetch("/assets/html/header.html", { cache: "no-store" }).then(r => r.text()),
      fetch("/assets/html/footer.html", { cache: "no-store" }).then(r => r.text()).catch(() => "")
    ]);

    const headerMount = $("#site-header");
    const footerMount = $("#site-footer");

    if (headerMount) headerMount.innerHTML = headerHtml;
    if (footerMount && footerHtml) footerMount.innerHTML = footerHtml;
  } catch (e) {
    console.error("Header/footer inject failed:", e);
  }

  // 3) Highlight active nav item based on data-page or URL
  try {
    const pageAttr = document.documentElement.getAttribute("data-page"); // e.g. "home"
    const map = {
      "/home.html": "home",
      "/study.html": "study",
      "/practice/index.html": "practice",
      "/contactus.html": "contact",
      "/login.html": "login",
    };

    const path = (location.pathname || "/").toLowerCase();
    const key  = pageAttr || map[path];

    if (key) {
      $$(".site-nav a[data-nav]").forEach(a => {
        a.classList.toggle("active", a.getAttribute("data-nav") === key);
      });
    }
  } catch (e) {
    console.warn("Nav highlight failed:", e);
  }

  // 4) Auth greeting + login/logout UI
  const greetingEl = $("#user-greeting");
  const loginLink  = $("#login-link");
  const logoutBtn  = $("#logout-btn");

  // If header markup isn’t present, don’t try to wire auth UI
  if (!greetingEl || !loginLink || !logoutBtn) {
    console.warn("Auth UI elements not found in header.");
    return;
  }

  // Logout handler
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "/"; // back to home as logged-out
    } catch (e) {
      console.error("Sign out failed:", e);
    }
  });

  // Helper: get first name from Firestore or Auth object
  async function getFirstName(user) {
    if (!user) return null;

    // Try Firestore `users/{uid}` first
    try {
      const ref  = doc(db, "users", user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        if (data && data.name) {
          return String(data.name).split(" ")[0];
        }
      }
    } catch (e) {
      console.warn("Failed to load profile from Firestore:", e);
    }

    // Fallbacks from auth object
    if (user.displayName) return user.displayName.split(" ")[0];
    if (user.email)       return user.email.split("@")[0];
    return "there";
  }

  // Watch auth state and update header
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const first = await getFirstName(user);
      greetingEl.textContent   = `Hi, ${first}`;
      loginLink.style.display  = "none";
      logoutBtn.style.display  = "inline-flex";
    } else {
      greetingEl.textContent   = "";
      loginLink.style.display  = "inline-flex";
      logoutBtn.style.display  = "none";
    }
  });
}

// Ensure we run after the DOM is ready (so <body> exists)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initShell);
} else {
  initShell();
}
