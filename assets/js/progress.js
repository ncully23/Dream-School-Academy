// /assets/js/progress.js
// "My Progress" page: shows ONLY Firestore attempts for the logged-in user.
// Adds hyperlinks to re-open attempt review pages by attemptId.
// Fixes table column mismatch (renders 7 columns to match progress/index.html).

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

    if (!summaryEl || !historyBody) {
      // Page isn't wired for this script; exit quietly
      return;
    }

    const state = {
      attempts: []
    };

    // -----------------------------
    // Helpers
    // -----------------------------
    function secToHMS(sec) {
      if (!sec || sec <= 0) return "—";
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      if (h) return `${h}h ${m}m ${s}s`;
      if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
      return `${s}s`;
    }

    function computePercent(score, total) {
      if (!total || total <= 0) return 0;
      return Math.round((score / total) * 10000) / 100; // 2 decimals
    }

    function toDateMaybe(ts) {
      if (!ts) return new Date();
      if (ts instanceof Date) return ts;
      if (typeof ts === "string") return new Date(ts);
      if (typeof ts.toDate === "function") return ts.toDate(); // Firestore Timestamp
      return new Date();
    }

    function escapeHtml(str) {
      if (!str) return "";
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
      // Universal review page (recommended)
      return `/pages/review.html?attemptId=${encodeURIComponent(attemptId)}`;
    }

    /**
     * Normalize a Firestore attempt (from quizData.loadAllResultsForUser)
     * into a shape used by the UI:
     *
     * {
     *   id: string,
     *   attemptId: string,
     *   timestamp: Date,
     *   score: number,
     *   total: number,
     *   percent: number,
     *   durationSeconds: number,
     *   title: string,
     *   sectionId: string | null
     * }
     */
    function normalizeAttempt(raw) {
      // Minimal fallback record
      if (!raw || !raw.totals || !Array.isArray(raw.items)) {
        const fallbackTime = toDateMaybe(raw && (raw.createdAt || raw.timestamp));
        const fallbackId = (raw && (raw.id || raw.attemptId)) || ("unknown_" + fallbackTime.getTime());
        return {
          id: fallbackId,
          attemptId: fallbackId,
          timestamp: fallbackTime,
          score: 0,
          total: 0,
          percent: 0,
          durationSeconds: 0,
          title: "Practice",
          sectionId: raw && raw.sectionId ? raw.sectionId : null
        };
      }

      const totals = raw.totals;
      const items = raw.items;

      const score = typeof totals.correct === "number" ? totals.correct : 0;

      const total =
        typeof totals.total === "number" ? totals.total : items.length;

      const percent =
        typeof totals.scorePercent === "number"
          ? totals.scorePercent
          : computePercent(score, total);

      const durationSeconds =
        typeof totals.timeSpentSec === "number"
          ? totals.timeSpentSec
          : (typeof raw.durationSeconds === "number" ? raw.durationSeconds : 0);

      const ts = raw.createdAt || raw.generatedAt || raw.timestamp || null;
      const timestamp = toDateMaybe(ts);

      const sectionId = raw.sectionId || null;
      const title = raw.title || raw.sectionTitle || sectionId || "Practice";

      const attemptId = raw.id || raw.attemptId || ("fs_" + timestamp.getTime());

      return {
        id: attemptId,        // keep for backwards compatibility
        attemptId: attemptId, // explicit for hyperlinks
        timestamp,
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
        throw new Error("Progress: quizData API not available. Make sure quiz-data.js is loaded.");
      }

      // This internally calls requireUser(), so it will reject if not signed in
      const rawFs = (await window.quizData.loadAllResultsForUser()) || [];

      return rawFs
        .map((r) => normalizeAttempt(r))
        .sort((a, b) => b.timestamp - a.timestamp); // newest → oldest
    }

    // -----------------------------
    // Rendering
    // -----------------------------
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
        const score = Number(r.score || 0);
        const total = Number(r.total || 0);
        const pct = total > 0 ? computePercent(score, total) : 0;

        totalQuestions += total;
        totalCorrect += score;
        totalTime += Number(r.durationSeconds || 0);
        if (pct > bestPercent) bestPercent = pct;
      });

      const avgPercent = totalQuestions > 0 ? computePercent(totalCorrect, totalQuestions) : 0;

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
            <td colspan="7">No quizzes recorded yet.</td>
          </tr>
        `;
        return;
      }

      const rows = list.map((r) => {
        const dateStr = r.timestamp.toLocaleString();
        const percentStr = `${Number(r.percent || 0).toFixed(1)}%`;

        const href = r.attemptId ? buildReviewHref(r.attemptId) : null;

        const titleHtml = href
          ? `<a class="history-link" href="${href}">${escapeHtml(r.title || "Practice")}</a>`
          : escapeHtml(r.title || "Practice");

        return `
          <tr>
            <td class="cell-date">${escapeHtml(dateStr)}</td>
            <td class="cell-title">${titleHtml}</td>
            <td class="cell-score">
              <span class="score-pill">${escapeHtml(percentStr)}</span>
            </td>
            <td class="cell-total">${Number(r.score || 0)} / ${Number(r.total || 0)}</td>
            <td class="cell-pct">${escapeHtml(percentStr)}</td>
            <td class="cell-time">${escapeHtml(secToHMS(r.durationSeconds))}</td>
            <td class="cell-details">${detailsHtml}</td>
          </tr>
        `;
      });

      historyBody.innerHTML = rows.join("");
    }

    // -----------------------------
    // Main refresh
    // -----------------------------
    async function refresh() {
      try {
        if (loadingEl) loadingEl.style.display = "block";
        if (bannerEl) bannerEl.style.display = "none";

        const list = await fetchAllResults();
        state.attempts = list;

        renderSummary(list);
        renderHistory(list);
      } catch (err) {
        console.error("progress.js: refresh failed", err);

        const msg =
          (err && err.message && err.message.includes("Not signed in")) ||
          (err && err.message && err.message.includes("Not signed"))
            ? "Sign in to your account to see your saved progress."
            : "Could not load your progress. Please try again later.";

        summaryEl.innerHTML = `
          <div class="empty-state">
            <h2>Progress unavailable</h2>
            <p>${escapeHtml(msg)}</p>
          </div>
        `;

        historyBody.innerHTML = '<tr><td colspan="7">No data to display.</td></tr>';

        if (bannerEl) {
          bannerEl.textContent = msg;
          bannerEl.classList.add("warning");
          bannerEl.style.display = "block";
        }
      } finally {
        if (loadingEl) loadingEl.style.display = "none";
      }
    }

    // -----------------------------
    // Init
    // -----------------------------
    function init() {
      refresh().catch((err) => console.error("progress.js: initial refresh failed", err));
    }

    init();
  });
})();
