// /assets/js/admin/students.js
(function () {
  "use strict";

  if (window.__dsa_admin_students_initialized) return;
  window.__dsa_admin_students_initialized = true;

  document.addEventListener("DOMContentLoaded", () => {
    main().catch((err) => {
      console.error("[students] fatal:", err);
      setBanner(`Error: ${err?.message || String(err)}`, "error");
      setStatus("Admin load failed.");
    });
  });

  async function main() {
    setBanner("", "clear");

    await waitForAdminAuth();

    const statusEl = document.getElementById("adminStatus");
    const bodyEl = document.getElementById("studentsBody");

    if (!bodyEl) {
      throw new Error('Missing <tbody id="studentsBody"> in allstudents.html');
    }

    const user = await window.dsaAdminAuth.requireAdminOrRedirect();
    if (statusEl) statusEl.textContent = `Admin signed in: ${user.email || user.uid}`;

    const db = firebase.firestore();

    // Prefer createdAt ordering if it exists, otherwise fall back.
    let snap;
    try {
      snap = await db.collection("users").orderBy("createdAt", "desc").limit(500).get();
    } catch (e) {
      console.warn("[students] orderBy(createdAt) failed; falling back to unordered:", e);
      snap = await db.collection("users").limit(500).get();
    }

    bodyEl.innerHTML = "";

    if (snap.empty) {
      bodyEl.innerHTML = `<tr><td colspan="4">No users found.</td></tr>`;
      return;
    }

    snap.forEach((doc) => {
      const data = doc.data() || {};
      const uid = doc.id;

      const name =
        safeStr(data.displayName) ||
        safeStr(data.name) ||
        safeStr(data.fullName) ||
        "(no name)";

      const email = safeStr(data.email) || "(no email)";

      // Build link relative to this folder (works for /admin/* and /pages/admin/*)
      const studentUrl = new URL("student.html", window.location.href);
      studentUrl.searchParams.set("uid", uid);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(email)}</td>
        <td style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
          ${escapeHtml(uid)}
        </td>
        <td><a href="${escapeHtml(studentUrl.toString())}">View</a></td>
      `;
      bodyEl.appendChild(tr);
    });
  }

  // ---- waiting / UI helpers ----
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function waitForAdminAuth(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.dsaAdminAuth && typeof window.dsaAdminAuth.requireAdminOrRedirect === "function") return;
      await sleep(50);
    }
    throw new Error(
      "Admin auth helper missing. Ensure /assets/js/admin/adminauth.js is loaded BEFORE students.js (or at least on the page)."
    );
  }

  function setStatus(text) {
    const el = document.getElementById("adminStatus");
    if (el) el.textContent = text;
  }

  function setBanner(msg, kind) {
    const el = document.getElementById("adminBanner");
    if (!el) return;
    if (!msg || kind === "clear") {
      el.textContent = "";
      el.style.display = "none";
      el.className = "";
      return;
    }
    el.textContent = msg;
    el.style.display = "block";
    el.className = `banner banner-${kind || "info"}`;
  }

  function safeStr(v) {
    return typeof v === "string" && v.trim() ? v.trim() : "";
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
