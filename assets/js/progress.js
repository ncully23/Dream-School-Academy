// /assets/js/progress.js
// "My Progress" page:
// - Shows ONLY Firestore attempts for the logged-in user.
// - Hyperlink on quiz title -> /pages/review.html?attemptId=...
// - Renders 6 columns: Date, Category, Score, Total, % Correct, Duration
// - Uses localStorage (dsa:attempt:*) ONLY as a diagnostic to detect unsynced attempts.
// - Friendly error states: signed out vs permission denied vs generic.

(function () {
  "use strict";

  // Prevent double initialization if script is loaded twice
  if (window.__dsa_progress_initialized) return;
  window.__dsa_progress_initialized = true;

  document.addEventListener("DOMContentLoaded", function () {
    // -----------------------------
    // DOM cache
    // -----------------------------
    const summaryEl = document.getElementById("summary");
    const historyTable = document.getElementById("historyTable");
    const historyBody =
      document.getElementById("historyBody") ||
      (historyTable ? historyTable.querySelector("tbody") : null);

    // Optional elements
    const loadingEl = document.getElementById("progressLoading");
    const bannerEl = document.getElementById("unsyncedBanner"); // repurposed as info/error banner

    if (!summaryEl || !historyBody) return;

    const state = { attempts: [] };

    // -----------------------------
    // UI helpers
    // -----------------------------
    function showBanner(kind, text) {
      if (!bannerEl) return;
      bannerEl.classList.remove("warning", "success", "info", "error");
      if (kind) bannerEl.classList.add(kind);
      bannerEl.textContent = text || "";
      bannerEl.style.display = text ? "block" : "none";
    }

    function setLoading(isLoading) {
      if (!loadingEl) return;
      loadingEl.style.display = isLoading ? "block" : "none";
    }

    // -----------------------------
    // Formatting helpers
    // -----------------------------
    function secToHMS(sec) {
      const n = Number(sec);
      if (!Number.isFinite(n) || n <= 0) return "—";
      const h = Math.floor(n / 3600);
      const m = Math.floor((n % 3600) / 60);
      const s = Math.floor(n % 60);
      if (h) return `${h}h ${m}m ${s}s`;
      if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
      return `${s}s`;
    }

    function computePercent(score, total) {
      const s = Number(score);
      const t = Number(total);
      if (!Number.isFinite(t) || t <= 0) return 0;
      if (!Number.isFinite(s) || s < 0) return 0;
      return Math.round((s / t) * 1000) / 10; // 1 decimal
    }

    function escapeHtml(str) {
      if (str == null) return "";
      return String(str).replace(/[&<>"']/g, (m) => {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[m];
      });
    }

    function buildReviewHref(attemptId) {
      return `/pages/review.html?attemptId=${encodeURIComponent(attemptId)}`;
    }

    function toDateMaybe(ts) {
      if (!ts) return null;
      if (ts instanceof Date) return ts;
      if (typeof ts === "string") {
        const d = new Date(ts);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      if (typeof ts?.toDate === "function") {
        try {
          const d = ts.toDate();
          return d instanceof Date ? d : null;
        } catch {
          return null;
        }
      }
      return null;
    }

    function fmtDate(tsLike) {
      const d = toDateMaybe(tsLike);
      return d ? d.toLocaleString() : "—";
    }

    // -----------------------------
    // Error classification
    // -----------------------------
    function isPermissionDenied(err) {
      const msg = String((err && err.message) || "").toLowerCase();
      const code = String((err && err.code) || "").toLowerCase();
      return (
        code === "permission-denied" ||
        msg.includes("missing or insufficient permissions") ||
        msg.includes("permission denied")
      );
    }

    function isNotSignedIn(err) {
      const msg = String((err && err.message) || "").toLowerCase();
      const code = String((err && err.code) || "").toLowerCase();
      return (
        code === "auth/no-current-user" ||
        code === "auth/unauthorized" ||
        msg.includes("not signed in") ||
        msg.includes("not signed") ||
        msg.includes("no user")
      );
    }

    // -----------------------------
    // Local diagnostic (from progresspage.js): count local attempts
    // -----------------------------
    function countLocalAttemptKeys() {
      try {
        let n = 0;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("dsa:attempt:")) n++;
        }
        return n;
      } catch {
        return 0;
      }
    }

    // -----------------------------
    // Auth gating (prevents permission errors)
    // -----------------------------
    async function requireSignedInUserOrThrow() {
      // Preferred: modular auth via quizData
      if (window.quizData && typeof window.quizData.waitForAuthReady === "function") {
        const user = await window.quizData.waitForAuthReady();
        if (user) return user;
        throw new Error("Not signed in");
      }

      // Optional compat fallback (only if compat is present)
      if (window.firebase && typeof window.firebase.auth === "function") {
        const user = window.firebase.auth().currentUser;
        if (user) return user;
        throw new Error("Not signed in");
      }

      throw new Error(
        "Progress: auth API not available. Ensure /assets/js/quiz-data.js is loaded (modular)."
      );
    }

    // -----------------------------
    // Normalize attempt shapes (expanded from progresspage.js)
    // -----------------------------
    function normalizeAttempt(raw) {
      const a = raw || {};
      const totals = a.totals || {};

      const items = Array.isArray(a.items) ? a.items : [];
      const itemsLen = items.length;

      const total = Number.isFinite(totals.total)
        ? totals.total
        : (Number(a.total ?? a.numQuestions ?? itemsLen) || 0);

      const score = Number.isFinite(totals.correct)
        ? totals.correct
        : (Number(a.correct ?? a.numCorrect ?? a.score) || 0);

      const durationSeconds = Number.isFinite(totals.timeSpentSec)
        ? totals.timeSpentSec
        : (Number(a.timeSpentSec ?? a.durationSeconds ?? a.durationSec) || 0);

      const percent = Number.isFinite(totals.scorePercent)
        ? totals.scorePercent
        : (Number.isFinite(a.scorePercent) ? a.scorePercent : computePercent(score, total));

      // attemptId should be the engine's attemptId (t_...), not Firestore doc id.
      const attemptId = String(a.attemptId || a.attemptID || a.id || "");

      // Title/category
      const sectionId = String(a.sectionId || a.quizId || a.examType || "");
      const title = String(a.title || a.sectionTitle || sectionId || "Practice");

      // Prefer a stable display timestamp:
      // - createdAt (Timestamp) if present
      // - generatedAt (ISO)
      // - timestamp (ISO)
      const createdLike = a.createdAt || a.generatedAt || a.timestamp || a.completedAt || null;
      const dateObj = toDateMaybe(createdLike);

      return {
        attemptId,
        timestamp: dateObj || new Date(0),
        score,
        total,
        percent,
        durationSeconds,
        title,
        sectionId
      };
    }

    // -----------------------------
    // Data loading: Firestore only
    // -----------------------------
    async function fetchAllResults() {
      if (!window.quizData || typeof window.quizData.loadAllResultsForUser !== "function") {
        throw new Error(
          "Progress: quizData API not available. Make sure /assets/js/quiz-data.js is loaded."
        );
      }

      await requireSignedInUserOrThrow();

      const rawFs = (await window.quizData.loadAllResultsForUser()) || [];
      return rawFs
        .map(normalizeAttempt)
        .filter((a) => a && a.attemptId) // require attemptId for review links
        .sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0));
    }

    // -----------------------------
    // Rendering
    // -----------------------------
    function renderEmptyState(message) {
      summaryEl.innerHTML = `
        <div class="empty-state">
          <h2>Progress unavailable</h2>
          <p>${escapeHtml(message || "No data available.")}</p>
        </div>
      `;
      historyBody.innerHTML = '<tr><td colspan="6">No data to display.</td></tr>';
    }

    function renderSummary(list) {
      if (!list || !list.length) {
        summaryEl.innerHTML = `
          <div class="empty-state">
            <h2>No practice data yet</h2>
            <p>Complete a practice module while signed in, then return here to see your progress.</p>
          </div>
        `;
        return;
      }

      const totalTests = list.length;

      let totalQuestions = 0;
      let totalCorrect = 0;
      let bestPercent = 0;
      let totalTime = 0;

      list.forEach((r) => {
        const s = Number(r.score || 0);
        const t = Number(r.total || 0);
        const p = computePercent(s, t);

        totalQuestions += t;
        totalCorrect += s;
        totalTime += Number(r.durationSeconds || 0);
        if (p > bestPercent) bestPercent = p;
      });

      const avgPercent = computePercent(totalCorrect, totalQuestions);

      summaryEl.innerHTML = `
        <div class="summary-grid">
          <div class="summary-card">
            <div class="label">Total quizzes</div>
            <div class="value">${totalTests}</div>
            <div class="hint">Each completed module counts once.</div>
          </div>

          <div class="summary-card">
            <div class="label">Average score</div>
            <div class="value">${avgPercent.toFixed(1)}%</div>
            <div class="hint">Across all questions answered.</div>
          </div>

          <div class="summary-card">
            <div class="label">Best score</div>
            <div class="value">${bestPercent.toFixed(1)}%</div>
            <div class="hint">Highest score on any quiz.</div>
          </div>

          <div class="summary-card">
            <div class="label">Total time</div>
            <div class="value">${secToHMS(totalTime)}</div>
            <div class="hint">Approximate time spent practicing.</div>
          </div>
        </div>
      `;
    }

    function renderHistory(list) {
      if (historyTable) historyTable.style.display = "";

      if (!list || !list.length) {
        historyBody.innerHTML = `
          <tr>
            <td colspan="6">No quizzes recorded yet.</td>
          </tr>
        `;
        return;
      }

      historyBody.innerHTML = list
        .map((r) => {
          const dateStr = r.timestamp ? r.timestamp.toLocaleString() : "—";
          const pctStr = `${Number(r.percent || 0).toFixed(1)}%`;

          const href = r.attemptId ? buildReviewHref(r.attemptId) : null;
          const titleHtml = href
            ? `<a class="history-link" href="${href}">${escapeHtml(r.title || "Practice")}</a>`
            : escapeHtml(r.title || "Practice");

          return `
            <tr>
              <td class="cell-date">${escapeHtml(dateStr)}</td>
              <td class="cell-title">${titleHtml}</td>
              <td class="cell-score"><span class="score-pill">${escapeHtml(pctStr)}</span></td>
              <td class="cell-total">${Number(r.score || 0)} / ${Number(r.total || 0)}</td>
              <td class="cell-pct">${escapeHtml(pctStr)}</td>
              <td class="cell-time">${escapeHtml(secToHMS(r.durationSeconds))}</td>
            </tr>
          `;
        })
        .join("");
    }

    function renderSignedOut(localCount) {
      const extra =
        localCount > 0
          ? ` (Note: ${localCount} local attempt${localCount === 1 ? "" : "s"} exist on this device but are not saved to your account.)`
          : "";

      showBanner("warning", `Sign in to your account to see your saved progress${extra}`);
      summaryEl.innerHTML = `
        <div class="empty-state">
          <h2>Progress unavailable</h2>
          <p>Sign in to your account to see your saved progress${escapeHtml(extra)}</p>
          <p><a class="btn" href="/profile/login.html">Log in / Sign up</a></p>
        </div>
      `;
      historyBody.innerHTML = '<tr><td colspan="6">No data to display.</td></tr>';
    }

    function renderPermissionDenied(localCount) {
      const extra =
        localCount > 0
          ? ` Local attempts exist (${localCount}) but Firestore access is blocked.`
          : "";

      showBanner(
        "warning",
        `Signed in, but Firestore rules are blocking access to your progress (permission denied).${extra}`
      );

      summaryEl.innerHTML = `
        <div class="empty-state">
          <h2>Progress unavailable</h2>
          <p>Your account is signed in, but Firestore rules are blocking access to your progress.</p>
          <p class="muted">
            Fix: allow the signed-in user to read <code>users/{uid}/examAttempts</code>.
          </p>
        </div>
      `;
      historyBody.innerHTML = '<tr><td colspan="6">No data to display.</td></tr>';
    }

    // -----------------------------
    // Main refresh
    // -----------------------------
    async function refresh() {
      const localCount = countLocalAttemptKeys();

      try {
        setLoading(true);
        showBanner(null, "");

        // Auth gate first: if signed out, do NOT touch Firestore
        await requireSignedInUserOrThrow();

        const list = await fetchAllResults();
        state.attempts = list;

        renderSummary(list);
        renderHistory(list);

        // Diagnostic: local attempts exist but Firestore is empty
        if (localCount > 0 && list.length === 0) {
          showBanner(
            "info",
            `No Firestore attempts found, but ${localCount} local attempt${localCount === 1 ? "" : "s"} exist on this device. This usually means the quiz couldn't write to Firestore (rules) or you weren't signed in when finishing.`
          );
        }
      } catch (err) {
        console.error("progress.js: refresh failed", err);

        if (isNotSignedIn(err)) {
          renderSignedOut(localCount);
          return;
        }

        if (isPermissionDenied(err)) {
          renderPermissionDenied(localCount);
          return;
        }

        // Generic failure
        const msg =
          localCount > 0
            ? `Could not load your progress from Firestore. (${localCount} local attempt${localCount === 1 ? "" : "s"} exist on this device.)`
            : "Could not load your progress. Please try again later.";

        showBanner("warning", msg);
        renderEmptyState(msg);
      } finally {
        setLoading(false);
      }
    }

    // -----------------------------
    // Init
    // -----------------------------
    refresh().catch((err) =>
      console.error("progress.js: initial refresh failed", err)
    );
  });
})();
