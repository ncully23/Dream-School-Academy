// /assets/js/admin/adminauth.js
(function () {
  "use strict";

  // -----------------------------
  // CONFIG
  // -----------------------------
  // Put your admin UID(s) here (must match your Firestore rules allowlist)
  const ADMIN_UIDS = new Set(["7mv59VrUnJaZ7D2Kezb7cXCo2U53"]);

  // IMPORTANT: use an ABSOLUTE path (leading "/") so redirects work from /admin/* pages.
  // Set this to wherever your login page actually lives.
  const LOGIN_PATH = "/profile/login.html";

  // Where to send non-admin signed-in users
  const NOT_AUTHORIZED_PATH = "/";

  // Init guard
  if (window.dsaAdminAuth) return;

  // -----------------------------
  // small utilities
  // -----------------------------
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Wait for Firebase compat Auth to exist
  async function waitForFirebaseAuthReady({ timeoutMs = 8000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.firebase && typeof firebase.auth === "function") return true;
      await sleep(50);
    }
    throw new Error(
      "Firebase Auth not available on this page. Load firebase-app-compat.js, firebase-auth-compat.js, and firebase.initializeApp(...) before adminauth.js."
    );
  }

  // -----------------------------
  // public API
  // -----------------------------
  function isAdminUid(uid) {
    return ADMIN_UIDS.has(uid);
  }

  /**
   * Enforce:
   * - user must be signed in
   * - user.uid must be in ADMIN_UIDS
   *
   * If not signed in -> redirect to LOGIN_PATH
   * If signed in but not admin -> redirect to NOT_AUTHORIZED_PATH
   *
   * Returns the firebase user object if allowed.
   */
  async function requireAdminOrRedirect() {
    await waitForFirebaseAuthReady();

    const auth = firebase.auth();

    return new Promise((resolve) => {
      const unsub = auth.onAuthStateChanged(
        (user) => {
          try {
            unsub();
          } catch (_) {}

          if (!user) {
            window.location.href = LOGIN_PATH;
            return;
          }

          if (!isAdminUid(user.uid)) {
            window.location.href = NOT_AUTHORIZED_PATH;
            return;
          }

          resolve(user);
        },
        (err) => {
          console.error("[adminauth] onAuthStateChanged error:", err);
          window.location.href = LOGIN_PATH;
        }
      );
    });
  }

  /**
   * Non-redirecting check (useful for conditional UI).
   * Resolves to user if signed in, else null.
   */
  async function getCurrentUser({ timeoutMs = 8000 } = {}) {
    await waitForFirebaseAuthReady({ timeoutMs });

    const auth = firebase.auth();
    const existing = auth.currentUser;
    if (existing) return existing;

    return new Promise((resolve) => {
      const unsub = auth.onAuthStateChanged(
        (user) => {
          try {
            unsub();
          } catch (_) {}
          resolve(user || null);
        },
        (err) => {
          console.error("[adminauth] onAuthStateChanged error:", err);
          resolve(null);
        }
      );
    });
  }

  window.dsaAdminAuth = {
    requireAdminOrRedirect,
    isAdminUid,
    getCurrentUser,

    // export paths for other admin scripts if they want them
    LOGIN_PATH,
    NOT_AUTHORIZED_PATH,
  };
})();
