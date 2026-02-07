// /assets/js/admin/adminauth.js
(function () {
  "use strict";

  const ADMIN_UIDS = new Set(["7mv59VrUnJaZ7D2Kezb7cXCo2U53"]);

  if (window.dsaAdminAuth) return; // prevent double-load

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitForFirebaseReady({ timeoutMs = 8000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.firebase && typeof firebase.auth === "function") return true;
      await sleep(50);
    }
    throw new Error(
      "Firebase Auth not available on this page. Ensure compat SDK + firebase.initializeApp(...) are loaded before admin scripts."
    );
  }

  async function requireAdminOrRedirect() {
    await waitForFirebaseReady();

    const auth = firebase.auth();

    return new Promise((resolve) => {
      const unsub = auth.onAuthStateChanged(
        (user) => {
          try { unsub(); } catch (_) {}

          if (!user) {
            window.location.href = "/pages/login.html";
            return;
          }

          if (!ADMIN_UIDS.has(user.uid)) {
            window.location.href = "/";
            return;
          }

          resolve(user);
        },
        (err) => {
          console.error("[adminauth] onAuthStateChanged error:", err);
          window.location.href = "/pages/login.html";
        }
      );
    });
  }

  function isAdminUid(uid) {
    return ADMIN_UIDS.has(uid);
  }

  window.dsaAdminAuth = {
    requireAdminOrRedirect,
    isAdminUid,
  };
})();
