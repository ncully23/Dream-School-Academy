// /assets/shell.js (module)

// Reuse shared Firebase instances
import { auth, db } from "/assets/firebase-init.js";

// Pull in helpers that work *with* those instances
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// Small DOM helpers
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Inject header/footer, then wire everything up
async function initShell() {
  // 1) Ensure header/footer mount points
  function ensureMount(id, where = "start") {
    if (!document.getElementById(id)) {
      const el = document.createElement("div");
      el.id = id;
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
    $("#site-header").innerHTML = headerHtml;
    if (footerHtml) {
      $("#site-footer").innerHTML = footerHtml;
    }
  } catch (e) {
    console.error("Header/footer inject failed:", e);
  }

  // 3) Highlight active nav
  try {
    const pageAttr = document.documentElement.getAttribute("data-page"); // e.g. "home"
    const map = {
      "/": "home",
      "/index.html": "home",
      "/study.html": "study",
      "/practice.html": "practice",
      "/contactus.html": "contact",
      "/login.html": "login",
    };
    const key = pageAttr || map[(location.pathname || "/").toLowerCase()];
    if (key) {
      $$(".site-nav a[data-nav]").forEach(a => {
        a.classList.toggle("active", a.getAttribute("data-nav") === key);
      });
    }
  } catch (e) {
    console.warn("Nav highlight failed:", e);
  }

  // 4) Auth greeting + login/logout — *modelled exactly after your working script*
  const greetingEl = $("#user-greeting");
  const loginLink  = $("#login-link");
  const logoutBtn  = $("#logout-btn");

  // If header didn't load for some reason, bail out
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

  // Helper to get first name from Firestore or Auth
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

    // Fallbacks
    if (user.displayName) return user.displayName.split(" ")[0];
    if (user.email)       return user.email.split("@")[0];
    return "there";
  }

  // Watch auth state and update header
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const first = await getFirstName(user);
      greetingEl.textContent = `Hi, ${first}`;
      loginLink.style.display  = "none";
      logoutBtn.style.display  = "inline-flex";
    } else {
      greetingEl.textContent   = "";
      loginLink.style.display  = "inline-flex";
      logoutBtn.style.display  = "none";
    }
  });
}

// Run once
initShell();
