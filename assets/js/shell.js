// /assets/js/shell.js
// ============================================================
// WHAT THIS FILE DOES:
// This is the "page chrome" manager — it handles all the parts of the page
// that wrap around your actual content: the header at the top, the footer
// at the bottom, the navigation menu, and the login/logout area.
//
// Specifically, it:
//   1. Loads the shared header.html and footer.html into every page
//   2. Highlights the navigation link for the page you're currently on
//   3. Updates the header to show "Hi, [Name] / Log out" when signed in,
//      or a "Log in" link when signed out
//   4. Shows or hides the Admin link depending on who is signed in
//
// HOW IT'S LOADED:
// Add this single line to every HTML page:
//   <script type="module" src="/assets/js/shell.js"></script>
// The "type=module" part is important — it lets us use modern import syntax.
//
// WHY THIS VERSION IS BETTER THAN THE OLD ONE:
// - Waits for the header HTML to actually be loaded before trying to find
//   buttons inside it (the old version sometimes raced and missed them)
// - Uses authReady so we don't render UI based on a half-loaded auth state
// - Smarter nav highlighting that handles /pages/*.html style URLs
// - A guard prevents the script from initializing twice if loaded multiple times
// - Fails gracefully instead of crashing if the header/footer can't be fetched
// ============================================================

// -----------------------------
// IMPORTS: pull in the tools we need from other files
// -----------------------------

// From our own firebase-init.js file (in the same folder):
//   - auth: the Firebase Authentication object (knows who's signed in)
//   - db:   the Firestore database object (used to read user profiles)
//   - authReady: a Promise that resolves once Firebase finishes its initial auth check
//                — waiting on this prevents UI flicker between "signed out" and "signed in"
import { auth, db, authReady } from "./firebase-init.js";

// From Firebase's official Auth SDK (loaded directly from Google's CDN):
//   - onAuthStateChanged: a function that calls our callback every time the user
//                         signs in, signs out, or has their session refreshed
//   - signOut: a function that signs the current user out
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// From Firebase's Firestore SDK:
//   - doc:    builds a reference to one specific document in the database
//   - getDoc: fetches the data inside that document
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// -----------------------------
// CONFIG: values you might want to change
// -----------------------------

// List of user IDs (UIDs) that should see the "Admin" link in the header.
// ⚠️ IMPORTANT: This is JUST a UI toggle — it only hides/shows the link.
// It does NOT protect admin pages! Real protection lives in your Firestore
// security rules. Make sure the SAME UIDs are listed in both places.
// We use a Set instead of an Array because Set.has() is faster for lookups.
const ADMIN_UIDS = new Set([
  "7mv59VrUnJaZ7D2Kezb7cXCo2U53", // Example admin user ID — replace/add as needed
]);

// Where to fetch the shared header and footer HTML snippets from.
// If you ever move these files, update the paths here in one place.
const PATHS = {
  header: "/assets/html/header.html",      // shared header (logo + nav + auth area)
  footer: "/assets/structure/footer.html", // shared footer (links + copyright)
};

// -----------------------------
// SMALL DOM HELPERS: shortcuts for finding elements on the page
// -----------------------------

// $ is a one-character shortcut for document.querySelector().
// Example: $("#user-greeting") finds the element with id="user-greeting"
// You can pass any CSS selector: "#id", ".class", "div > span", etc.
const $ = (sel) => document.querySelector(sel);

// $$ is a shortcut for document.querySelectorAll(), but converted into a real Array.
// Why convert? Because the default result (a NodeList) is missing some handy methods.
// Array.from() gives us .map(), .filter(), .find(), etc. — much friendlier to use.
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// -----------------------------
// PREVENT DOUBLE-INIT: make sure this script only runs once per page
// -----------------------------

// We attach a flag to the global window object the first time the script runs.
// If the script somehow gets loaded a second time (duplicate <script> tag,
// hot-reload during development, etc.), the flag is already there and we skip
// initialization — which would otherwise create duplicate event listeners.
if (!window.__dsa_shell_initialized) {
  window.__dsa_shell_initialized = true; // raise the flag
  initShell();                            // kick off the real work
}

// -----------------------------
// onReady: wait for the page's HTML to be parsed before running our setup
// -----------------------------

// Why we need this: if our script runs BEFORE the <body> has been parsed,
// document.body might not exist yet and we'd hit errors trying to use it.
// This helper handles both possible situations:
//   - Page is still loading → wait for the DOMContentLoaded event
//   - Page is already loaded → run the function right now
function onReady(fn) {
  if (document.readyState === "loading") {
    // The browser is still parsing HTML — listen for the "ready" event.
    // { once: true } automatically removes the listener after it fires once.
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    // HTML is already parsed — go ahead and run immediately.
    fn();
  }
}

// -----------------------------
// initShell: the main startup sequence — runs once when the page is ready
// -----------------------------

function initShell() {
  // Wrap everything in onReady so we know <body> exists by the time we touch it.
  // The arrow function is async so we can use `await` for the header/footer fetches.
  onReady(async () => {
    // STEP 1: Make sure the placeholder <div>s for header and footer exist.
    // These are where the fetched HTML will be injected. If your page already
    // has <div id="site-header"> in its markup, ensureMount() does nothing.
    ensureMount("site-header", "start"); // header goes at the top of <body>
    ensureMount("site-footer", "end");   // footer goes at the bottom of <body>

    // STEP 2: Fetch the header.html and footer.html files and inject them
    // into those mount points. We MUST await this — until it finishes, the
    // login/logout buttons inside the header don't yet exist in the DOM.
    await injectChrome();

    // STEP 3: Now that the header is in the page, we can:
    //   - Highlight the nav link matching the current page
    //   - Wire up the auth-related buttons and listeners
    highlightNav();
    wireAuthUi();
  });
}

// -----------------------------
// ensureMount: creates a placeholder <div> if one isn't already on the page
// -----------------------------

// Parameters:
//   id    – the id the new div should have (e.g., "site-header")
//   where – "start" to insert at the top of <body>, "end" for the bottom
function ensureMount(id, where = "start") {
  // If a div with this id already exists (because the page's HTML included
  // it manually), don't create a duplicate — just bail out.
  if (document.getElementById(id)) return;

  // Build a fresh <div> element and give it the requested id.
  const el = document.createElement("div");
  el.id = id;

  // Edge case: if <body> hasn't been created yet, we can't insert anything.
  // (This shouldn't happen because onReady gates us, but it's a safety net.)
  if (!document.body) return;

  // Insert the new div into <body>:
  //   "afterbegin" = first child of <body>  (top of the page)
  //   "beforeend"  = last child of <body>   (bottom of the page)
  document.body.insertAdjacentElement(
    where === "start" ? "afterbegin" : "beforeend",
    el
  );
}

// -----------------------------
// injectChrome: downloads header.html and footer.html, inserts them into mounts
// "Chrome" in this context means the surrounding UI (header/footer/nav) — not the browser!
// -----------------------------

async function injectChrome() {
  try {
    // Fetch BOTH files in parallel using Promise.all — this is faster than
    // fetching one and then the other, because the network requests overlap.
    const [headerHtml, footerHtml] = await Promise.all([
      // Fetch options:
      //   cache: "no-store" → always download fresh, never use a cached copy
      //   (important during development so you see your latest changes)
      // The .then() unwraps the Response: if the fetch succeeded (r.ok),
      // grab the body as text; otherwise return an empty string so we don't crash.
      fetch(PATHS.header, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")),
      fetch(PATHS.footer, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")),
    ]);

    // Find the placeholder divs we created in initShell().
    const headerMount = $("#site-header");
    const footerMount = $("#site-footer");

    // Inject the HTML — but only if BOTH the mount exists AND we got real content.
    // Using innerHTML wholesale-replaces whatever was in the div before.
    if (headerMount && headerHtml) headerMount.innerHTML = headerHtml;
    if (footerMount && footerHtml) footerMount.innerHTML = footerHtml;
  } catch (e) {
    // If anything goes wrong (offline, file missing, etc.), log it and move on.
    // The page won't have a header/footer, but it also won't be a blank screen.
    console.error("[shell] header/footer inject failed:", e);
  }
}

// -----------------------------
// highlightNav: figures out which page we're on and adds an "active" class
//               to the matching nav link in the header
// -----------------------------

function highlightNav() {
  try {
    // OPTION A: A page can explicitly say what it is by setting
    // <html data-page="practice">. If present, we trust that value first.
    const pageAttr = (document.documentElement.getAttribute("data-page") || "").trim();

    // OPTION B (fallback): Look at the URL path to figure out the page.
    // Lowercased so comparisons aren't case-sensitive.
    const path = (location.pathname || "/").toLowerCase();

    // A lookup table: URL path → logical page name.
    // Multiple URLs can map to the same page name (e.g., "/" and "/index.html"
    // both mean "home"). The page name is what we'll match against the nav
    // link's data-nav attribute.
    const map = {
      // Home page variations
      "/": "home",
      "/index.html": "home",
      "/home.html": "home",

      // Study section variations
      "/study": "study",
      "/study/": "study",
      "/study/index.html": "study",

      // Practice section variations
      "/practice": "practice",
      "/practice/": "practice",
      "/practice/index.html": "practice",

      // Progress section variations
      "/progress": "progress",
      "/progress/": "progress",
      "/progress/index.html": "progress",

      // Admin section variations
      "/admin": "admin",
      "/admin/": "admin",
      "/admin/allstudents.html": "admin",
      "/admin/student.html": "admin",

      // Login pages
      "/profile/login.html": "login",
      "/pages/profile/login.html": "login",

      // Quiz/review pages should highlight the "Practice" tab
      "/pages/quiz.html": "practice",
      "/pages/review.html": "practice",
    };

    // Start with whatever the HTML attribute told us (might be null).
    let key = pageAttr || null;

    // If we have no explicit hint, try to infer from the URL.
    if (!key) {
      // Walk every entry in the map and find the BEST match.
      // "Best" = longest matching path, so /admin/student.html beats /admin.
      let bestMatch = null;
      for (const route of Object.keys(map)) {
        // A route matches if the current path either equals it exactly,
        // or starts with it (handles folder-style routes like "/study/...").
        if (path === route || (route.endsWith("/") ? path.startsWith(route) : path.startsWith(route))) {
          // Keep this route if it's the first match OR longer than the current best.
          if (!bestMatch || route.length > bestMatch.length) bestMatch = route;
        }
      }
      // Look up the page name for the winning route.
      if (bestMatch) key = map[bestMatch];
    }

    // Couldn't figure out what page we're on — quietly bail rather than guessing.
    if (!key) return;

    // Find every nav link that has a data-nav attribute, e.g.
    // <a href="/practice" data-nav="practice">Practice</a>
    $$(".site-nav a[data-nav]").forEach((a) => {
      // This link is "active" if its data-nav value matches our page key.
      const isActive = a.getAttribute("data-nav") === key;

      // .classList.toggle(name, condition) is a one-liner for:
      //   if condition → add the class, else → remove it
      a.classList.toggle("active", isActive);

      // Accessibility bonus: aria-current="page" tells screen readers
      // "this is the current page" — important for users on assistive tech.
      if (isActive) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  } catch (e) {
    // Highlighting is a "nice to have" — if it fails, log a warning but
    // never break the rest of the page.
    console.warn("[shell] nav highlight failed:", e);
  }
}

// -----------------------------
// wireAuthUi: connects the login/logout buttons, greeting, and admin link
//             to the actual Firebase auth state
// -----------------------------

function wireAuthUi() {
  // Grab references to the four header elements we care about.
  // These IDs need to exist in your header.html for any of this to work.
  const greetingEl = $("#user-greeting"); // shows "Hi, [Name]"
  const loginLink  = $("#login-link");    // shown when nobody is signed in
  const logoutBtn  = $("#logout-btn");    // shown when somebody IS signed in
  const adminLink  = $("#admin-link");    // optional — only some pages show it

  // If the three required elements (greeting, login, logout) aren't found,
  // there's nothing for us to wire up. Log a hint and exit cleanly.
  // (adminLink is optional, so we don't require it here.)
  if (!greetingEl || !loginLink || !logoutBtn) {
    console.warn("[shell] Auth UI elements not found in header.");
    return;
  }

  // -----------------------------
  // Hook up the logout button — but only ONCE, even if wireAuthUi is called twice
  // -----------------------------

  // We use the button's dataset (a place to store custom info on an element)
  // as a flag. The first time we wire the button, we set bound="1". Next time
  // we see the flag is already there and skip — preventing duplicate listeners
  // that would otherwise fire signOut() multiple times per click.
  if (!logoutBtn.dataset.bound) {
    logoutBtn.dataset.bound = "1";

    logoutBtn.addEventListener("click", async () => {
      try {
        // Tell Firebase to sign the current user out.
        await signOut(auth);
        // Send the user back to the home page after signing out.
        window.location.href = "/";
      } catch (e) {
        // Sign-out can fail in rare edge cases (network blip, etc.).
        // Log it; the page state will sort itself out via onAuthStateChanged.
        console.error("[shell] Sign out failed:", e);
      }
    });
  }

  // -----------------------------
  // Helper: figure out what to call the user in the greeting
  // -----------------------------

  // Tries three sources, in order of preference:
  //   1. The "name" or "displayName" field from their Firestore profile doc
  //   2. The displayName attached to their Firebase Auth account
  //   3. The part of their email before the @ sign
  // If none of the above are available, returns "there" so the greeting still
  // reads naturally as "Hi, there".
  async function getFirstName(user) {
    if (!user) return null; // shouldn't happen, but guard anyway

    // --- Try Firestore first (gives us the name they actually set in their profile) ---
    try {
      // Build a reference to: users/{uid}
      const ref = doc(db, "users", user.uid);
      // Fetch the document.
      const snap = await getDoc(ref);
      if (snap.exists()) {
        // .data() returns the document's contents as a plain object.
        const data = snap.data() || {};
        // Accept either field name; trim trailing/leading whitespace.
        const name = (data.name || data.displayName || "").trim();
        // Take the first whitespace-separated word as the "first name".
        // The /\s+/ regex matches any run of whitespace (spaces, tabs, etc.).
        if (name) return String(name).split(/\s+/)[0];
      }
    } catch (e) {
      // Firestore read can fail (rules, network, etc.). Don't crash —
      // just fall through to the next fallback.
      console.warn("[shell] Failed to load profile from Firestore:", e);
    }

    // --- Fallback 1: Auth displayName (set during signup with some providers) ---
    if (user.displayName) return user.displayName.split(/\s+/)[0];

    // --- Fallback 2: the local part of their email (e.g., "alex" from "alex@x.com") ---
    if (user.email) return user.email.split("@")[0];

    // --- Last resort: a friendly generic word ---
    return "there";
  }

  // -----------------------------
  // Helper: show or hide the Admin link based on who's signed in
  // -----------------------------

  function setAdminLinkVisible(user) {
    // If your header doesn't include an admin link, skip silently.
    if (!adminLink) return;

    // Show the link only when:
    //   - someone is signed in (user is truthy), AND
    //   - their UID is in our ADMIN_UIDS set
    // !!(...) coerces the result to a strict boolean (true/false).
    const show = !!(user && ADMIN_UIDS.has(user.uid));

    // Toggle visibility via CSS:
    //   "inline-flex" → visible and behaves like a flex item
    //   "none"        → completely removed from layout
    adminLink.style.display = show ? "inline-flex" : "none";
  }

  // -----------------------------
  // Helper: render the header for a SIGNED-OUT visitor
  // -----------------------------

  function renderSignedOut() {
    // No user → never show the admin link.
    setAdminLinkVisible(null);

    // Wipe any leftover greeting and hide the element entirely.
    greetingEl.textContent = "";
    greetingEl.style.display = "none";
    // Remove the styling class that's only meant for signed-in users.
    greetingEl.classList.remove("is-logged-in");

    // Show "Log in", hide "Log out".
    loginLink.style.display = "inline-flex";
    logoutBtn.style.display = "none";
  }

  // -----------------------------
  // Helper: render the header for a SIGNED-IN user
  // -----------------------------

  async function renderSignedIn(user) {
    // First, decide whether the admin link should appear.
    setAdminLinkVisible(user);

    // Look up what to call them (this involves a Firestore read, hence await).
    const first = await getFirstName(user);

    // Personalized greeting.
    greetingEl.textContent = `Hi, ${first}`;
    greetingEl.style.display = "inline-flex";
    greetingEl.classList.add("is-logged-in"); // optional CSS hook for styling

    // Hide "Log in", show "Log out".
    loginLink.style.display = "none";
    logoutBtn.style.display = "inline-flex";
  }

  // -----------------------------
  // Wire everything up to Firebase's auth state
  // -----------------------------

  // authReady is the Promise from firebase-init.js that resolves AFTER Firebase
  // has finished its initial check ("is there a saved session in this browser?").
  // Waiting on it prevents the brief flicker where currentUser is briefly null
  // even though the user is actually signed in.
  authReady
    .then(() => {
      // Subscribe to auth changes. The callback fires:
      //   - immediately, with the current user (or null)
      //   - again every time the user signs in or out
      //   - when the auth token refreshes
      onAuthStateChanged(auth, async (user) => {
        try {
          if (user) await renderSignedIn(user); // logged in → personalized header
          else renderSignedOut();               // logged out → generic header
        } catch (e) {
          // If rendering itself blows up, fall back to the safe signed-out view
          // rather than leaving the header in a half-updated state.
          console.warn("[shell] auth UI render failed:", e);
          renderSignedOut();
        }
      });

      // Belt-and-suspenders: render the current state RIGHT NOW too.
      // onAuthStateChanged usually fires immediately, but this guarantees the
      // header is correct without waiting for the first event tick.
      const u = auth.currentUser;
      if (u) renderSignedIn(u).catch(() => {}); // ignore any render errors here
      else renderSignedOut();
    })
    .catch((e) => {
      // If authReady itself rejects (unusual — would mean Firebase config issue),
      // show the signed-out UI so the page is at least usable.
      console.warn("[shell] authReady failed:", e);
      renderSignedOut();
    });
}
