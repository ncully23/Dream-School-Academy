// /assets/js/shell.js
// Injects shared header/footer, highlights active nav, and wires up auth UI.
// Loaded as: <script type="module" src="/assets/js/shell.js"></script>

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
    // 1) Ensure header/footer mount points exist
    ensureMount("site-header", "start");
    ensureMount("site-footer", "end");

    // 2) Inject header + footer HTML
    await injectChrome();

    // 3) Highlight active nav item
    highlightNav();

    // 4) Wire up auth greeting + login/logout controls
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
      fetch("/assets/html/header.html", { cache: "no-store" }).then((r) =>
        r.ok ? r.text() : ""
      ),
      fetch("/assets/structure/footer.html", { cache: "no-store" })
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => "")
    ]);

    const headerMount = $("#site-header");
    const footerMount = $("#site-footer");

    if (headerMount && headerHtml) headerMount.innerHTML = headerHtml;
    if (footerMount && footerHtml) footerMount.innerHTML = footerHtml;
  } catch (e) {
    console.error("[shell] header/footer inject failed:", e);
  }
}

function highlightNav() {
  try {
    const pageAttr = document.documentElement.getAttribute("data-page"); // e.g. "practice"
    const path = (location.pathname || "/").toLowerCase();

    // Basic mapping for top-level pages
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

      "/profile/login.html": "login"
    };

    // Try explicit data-page first
    let key = pageAttr;

    // If no data-page, infer from path, including nested routes like
    // /practice/circles/preview.html → "practice"
    if (!key) {
      // Find the longest matching prefix in the map
      let bestMatch = null;
      Object.keys(map).forEach((route) => {
        if (path === route || path.startsWith(route)) {
          if (!bestMatch || route.length > bestMatch.length) {
            bestMatch = route;
          }
        }
      });
      if (bestMatch) key = map[bestMatch];
    }

    if (!key) return;

    $$(".site-nav a[data-nav]").forEach((a) => {
      const isActive = a.getAttribute("data-nav") === key;
      a.classList.toggle("active", isActive);
      if (isActive) {
        a.setAttribute("aria-current", "page");
      } else {
        a.removeAttribute("aria-current");
      }
    });
  } catch (e) {
    console.warn("[shell] nav highlight failed:", e);
  }
}

function wireAuthUi() {
  const greetingEl = $("#user-greeting");
  const loginLink  = $("#login-link");
  const logoutBtn  = $("#logout-btn");

  // If header markup isn’t present, don’t try to wire auth UI
  if (!greetingEl || !loginLink || !logoutBtn) {
    console.warn("[shell] Auth UI elements not found in header.");
    return;
  }

  // Logout handler
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      // After logout, send user to home page (or login page if you prefer)
      window.location.href = "/home.html";
    } catch (e) {
      console.error("[shell] Sign out failed:", e);
    }
  });

  // Helper: first name from Firestore or Auth object
  async function getFirstName(user) {
    if (!user) return null;

    // Try Firestore profile
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
      console.warn("[shell] Failed to load profile from Firestore:", e);
    }

    // Fallbacks from auth profile
    if (user.displayName) return user.displayName.split(" ")[0];
    if (user.email) return user.email.split("@")[0];
    return "there";
  }

  // Watch auth state and update header
  onAuthStateChanged(auth, async (user) => {
    if (!greetingEl || !loginLink || !logoutBtn) return;

    if (user) {
      const first = await getFirstName(user);

      greetingEl.textContent   = `Hi, ${first}`;
      greetingEl.style.display = "inline-flex";
      greetingEl.classList.add("is-logged-in");

      loginLink.style.display  = "none";
      logoutBtn.style.display  = "inline-flex";
    } else {
      greetingEl.textContent   = "";
      greetingEl.style.display = "none";
      greetingEl.classList.remove("is-logged-in");

      loginLink.style.display  = "inline-flex";
      logoutBtn.style.display  = "none";
    }
  });
}
