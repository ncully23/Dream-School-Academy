// /assets/js/shell.js
// Injects shared header/footer, highlights active nav, and wires up auth UI (incl. Admin button gate).
// Loaded as: <script type="module" src="/assets/js/shell.js"></script>

import { auth, db } from "./firebase-init.js";

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// -----------------------------
// Config
// -----------------------------

// UI-only admin gate (real security enforced by Firestore rules).
// Put the SAME UID you used in Firestore rules allowlist.
const ADMIN_UIDS = new Set([
  "PASTE_YOUR_ADMIN_UID_HERE",
]);

// Header/footer paths (match your repo)
const PATHS = {
  header: "/assets/html/header.html",
  footer: "/assets/structure/footer.html",
};

// -----------------------------
// Small DOM helpers
// -----------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Prevent double-init if script somehow gets loaded twice
if (!window.__dsa_shell_initialized) {
  window.__dsa_shell_initialized = true;
  initShell();
}

// Run after DOM is ready
function onReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

function initShell() {
  onReady(async () => {
    ensureMount("site-header", "start");
    ensureMount("site-footer", "end");

    await injectChrome();
    highlightNav();
    wireAuthUi();
  });
}

function ensureMount(id, where = "start") {
  if (document.getElementById(id)) return;

  const el = document.createElement("div");
  el.id = id;

  if (!document.body) return;

  document.body.insertAdjacentElement(
    where === "start" ? "afterbegin" : "beforeend",
    el
  );
}

// Fetch & inject header/footer
async function injectChrome() {
  try {
    const [headerHtml, footerHtml] = await Promise.all([
      fetch(PATHS.header, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")),
      fetch(PATHS.footer, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")),
    ]);

    const headerMount = $("#site-header");
    const footerMount = $("#site-footer");

    if (headerMount) headerMount.innerHTML = headerHtml || "";
    if (footerMount) footerMount.innerHTML = footerHtml || "";
  } catch (e) {
    console.error("[shell] header/footer inject failed:", e);
  }
}

function highlightNav() {
  try {
    const pageAttr = document.documentElement.getAttribute("data-page"); // e.g. "practice"
    const path = (location.pathname || "/").toLowerCase();

    const map = {
      "/": "home",
      "/home.html": "home",

      "/study": "study",
      "/study/": "study",
      "/study/index.html": "study",

      "/practice": "practice",
      "/practice/": "practice",
      "/practice/index.html": "practice",

      "/progress": "progress",
      "/progress/": "progress",
      "/progress/index.html": "progress",

      "/admin": "admin",
      "/admin/": "admin",
      "/admin/allstudents.html": "admin",
      "/admin/student.html": "admin",

      "/pages/profile/login.html": "login",
      "/profile/login.html": "login",
    };

    let key = pageAttr;

    if (!key) {
      let bestMatch = null;
      for (const route of Object.keys(map)) {
        if (path === route || path.startsWith(route)) {
          if (!bestMatch || route.length > bestMatch.length) bestMatch = route;
        }
      }
      if (bestMatch) key = map[bestMatch];
    }

    if (!key) return;

    $$(".site-nav a[data-nav]").forEach((a) => {
      const isActive = a.getAttribute("data-nav") === key;
      a.classList.toggle("active", isActive);
      if (isActive) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  } catch (e) {
    console.warn("[shell] nav highlight failed:", e);
  }
}

function wireAuthUi() {
  const greetingEl = $("#user-greeting");
  const loginLink = $("#login-link");
  const logoutBtn = $("#logout-btn");
  const adminLink = $("#admin-link");

  if (!greetingEl || !loginLink || !logoutBtn) {
    console.warn("[shell] Auth UI elements not found in header.");
    return;
  }

  if (!logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = "1";
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "/";
      } catch (e) {
        console.error("[shell] Sign out failed:", e);
      }
    });
  }

  async function getFirstName(user) {
    if (!user) return null;

    try {
      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() || {};
        const name = (data.name || data.displayName || "").trim();
        if (name) return String(name).split(/\s+/)[0];
      }
    } catch (e) {
      console.warn("[shell] Failed to load profile from Firestore:", e);
    }

    if (user.displayName) return user.displayName.split(/\s+/)[0];
    if (user.email) return user.email.split("@")[0];
    return "there";
  }

  function setAdminLinkVisible(user) {
    if (!adminLink) return;

    const show = !!(user && ADMIN_UIDS.has(user.uid));
    adminLink.style.display = show ? "inline-flex" : "none";

    // Debug (leave in while you’re testing; remove later)
    // console.log("[shell] admin gate:", { uid: user?.uid, show });
  }

  onAuthStateChanged(auth, async (user) => {
    setAdminLinkVisible(user);

    if (user) {
      const first = await getFirstName(user);

      greetingEl.textContent = `Hi, ${first}`;
      greetingEl.style.display = "inline-flex";
      greetingEl.classList.add("is-logged-in");

      loginLink.style.display = "none";
      logoutBtn.style.display = "inline-flex";
    } else {
      greetingEl.textContent = "";
      greetingEl.style.display = "none";
      greetingEl.classList.remove("is-logged-in");

      loginLink.style.display = "inline-flex";
      logoutBtn.style.display = "none";
    }
  });
}
