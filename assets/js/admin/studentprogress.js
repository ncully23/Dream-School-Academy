// /assets/js/admin/studentProgress.js
(function () {
  "use strict";

  const ATTEMPTS_SUBCOLLECTION = "attempts"; // TODO: change if yours is different

  document.addEventListener("DOMContentLoaded", async () => {
    const user = await window.dsaAdminAuth.requireAdminOrRedirect();

    const uid = new URLSearchParams(location.search).get("uid");
    if (!uid) {
      document.getElementById("studentMeta").textContent = "Missing ?uid=...";
      return;
    }

    const db = firebase.firestore();

    // 1) Load student profile
    const userDoc = await db.collection("users").doc(uid).get();
    const profile = userDoc.exists ? userDoc.data() : null;

    document.getElementById("studentTitle").textContent =
      profile?.displayName ? `Student: ${profile.displayName}` : `Student: ${uid}`;

    document.getElementById("studentMeta").textContent =
      profile?.email ? profile.email : `UID: ${uid}`;

    // 2) Load attempts
    const attemptsSnap = await db
      .collection("users").doc(uid)
      .collection(ATTEMPTS_SUBCOLLECTION)
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    const attempts = [];
    attemptsSnap.forEach((d) => attempts.push({ id: d.id, ...d.data() }));

    // 3) Render
    renderSummary(attempts);
    renderHistory(attempts, uid);
  });

  function renderSummary(attempts) {
    const summaryEl = document.getElementById("summary");
    if (!attempts.length) {
      summaryEl.innerHTML = `<p class="muted">No attempts yet.</p>`;
      return;
    }

    const totalAttempts = attempts.length;
    const avgPct = Math.round(
      (attempts.reduce((a, x) => a + pct(x), 0) / totalAttempts) * 10
    ) / 10;

    summaryEl.innerHTML = `
      <div class="card">
        <div><strong>Total attempts:</strong> ${totalAttempts}</div>
        <div><strong>Average score:</strong> ${avgPct}%</div>
      </div>
    `;
  }

  function renderHistory(attempts, studentUid) {
    const body = document.getElementById("historyBody");
    body.innerHTML = "";

    if (!attempts.length) {
      body.innerHTML = `<tr><td colspan="5">No attempts found.</td></tr>`;
      return;
    }

    for (const a of attempts) {
      const date = formatDate(a.createdAt);
      const quiz = a.quizTitle || a.quizId || "(unknown quiz)";
      const score = formatScore(a);
      const time = formatTime(a.timeSpentSec || a.durationSec || a.timeSpent || 0);

      // If your review page only needs attemptId, keep it simple:
      // If it needs uid too, add &uid=...
      const reviewHref = `/pages/review.html?attemptId=${encodeURIComponent(a.id)}&uid=${encodeURIComponent(studentUid)}`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(date)}</td>
        <td>${escapeHtml(quiz)}</td>
        <td>${escapeHtml(score)}</td>
        <td>${escapeHtml(time)}</td>
        <td><a href="${reviewHref}">Open</a></td>
      `;
      body.appendChild(tr);
    }
  }

  function pct(a) {
    const correct = Number(a.numCorrect ?? a.correct ?? 0);
    const total = Number(a.totalQuestions ?? a.total ?? a.numQuestions ?? 0);
    if (!total) return 0;
    return (correct / total) * 100;
  }

  function formatScore(a) {
    const correct = Number(a.numCorrect ?? a.correct ?? 0);
    const total = Number(a.totalQuestions ?? a.total ?? a.numQuestions ?? 0);
    return total ? `${correct}/${total} (${Math.round((correct / total) * 100)}%)` : `${correct}`;
  }

  function formatTime(sec) {
    sec = Number(sec) || 0;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function formatDate(ts) {
    // Firestore Timestamp -> Date
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
    if (!d) return "(no date)";
    return d.toLocaleString();
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
