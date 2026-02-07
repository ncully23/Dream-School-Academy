// /assets/js/admin/students.js
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", async () => {
    const statusEl = document.getElementById("adminStatus");
    const bodyEl = document.getElementById("studentsBody");

    const user = await window.dsaAdminAuth.requireAdminOrRedirect();
    statusEl.textContent = `Admin signed in: ${user.email || user.uid}`;

    const db = firebase.firestore();

    // Fetch students (all user docs). If you later add role filtering, do it here.
    const snap = await db.collection("users").orderBy("createdAt", "desc").get();

    bodyEl.innerHTML = "";
    snap.forEach((doc) => {
      const data = doc.data() || {};
      const uid = doc.id;
      const name = data.displayName || "(no name)";
      const email = data.email || "(no email)";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(email)}</td>
        <td style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
          ${escapeHtml(uid)}
        </td>
        <td><a href="/pages/admin/student.html?uid=${encodeURIComponent(uid)}">View</a></td>
      `;
      bodyEl.appendChild(tr);
    });

    if (snap.empty) {
      bodyEl.innerHTML = `<tr><td colspan="4">No users found.</td></tr>`;
    }
  });

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
