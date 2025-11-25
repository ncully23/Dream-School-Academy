// /assets/js/progress.js
// "My Progress" page: combines Firestore attempts (via quizData)
// with local attempt history (ATTEMPT_KEY from quiz-engine.js).

(function () {
  "use strict";

  // Prevent double initialization if script is loaded twice
  if (window.__dsa_progress_initialized) return;
  window.__dsa_progress_initialized = true;

  // Shared local-storage key (set by quiz-engine.js)
  const ATTEMPT_KEY =
    window.DSA_ATTEMPT_KEY || "dreamschool:attempts:v1";

  document.addEventListener("DOMContentLoaded", function () {
    // -----------------------------
    // DOM cache
    // -----------------------------
    const summaryEl = document.getElementById("summary");
    const historyTable = document.getElementById("historyTable");
    // Some layouts use a separate tbody with its own ID
    const historyBody =
      document.getElementById("historyBody") ||
      (historyTable ? historyTable.querySelector("tbody") : null);

    const exportBtn = document.getElementById("exportBtn");
    const clearBtn = document.getElementById("clearBtn");

    // Optional elements
    const loadingEl = document.getElementById("progressLoading");
    const unsyncedEl = document.getElementById("unsyncedBanner");

    if (!summaryEl || !historyBody) {
      // Page isn't wired for this script; exit quietly
      return;
    }

    // Store latest list in memory so export uses exactly what’s on-screen
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
      const s = sec % 60;
      if (h) return `${h}h ${m}m ${s}s`;
      if (m) return `${m}m ${s.toString().padStart(2, "0")}s`;
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

    /**
     * Normalize any attempt to a common shape:
     * {
     *   id: string,
     *   timestamp: Date,
     *   score: number,
     *   total: number,
     *   percent: number,
     *   durationSeconds: number,
     *   title: string,
     *   sectionId: string | null,
     *   synced: boolean      // true = Firestore, false = local-only
     * }
     */
    function normalizeAttempt(raw, options) {
      const opts = options || {};
      const fromFirestore = !!opts.fromFirestore;

      // Case 1: Firestore summary created by quiz-data.appendAttempt
      // shape: { totals, items, sectionId, title, generatedAt/createdAt, ... }
      if (raw && raw.totals && Array.isArray(raw.items)) {
        const totals = raw.totals;
        const items = raw.items;

        const score =
          typeof totals.correct === "number" ? totals.correct : 0;
        const total =
          typeof totals.total === "number" ? totals.total : items.length;
        const percent =
          typeof totals.scorePercent === "number"
            ? totals.scorePercent
            : computePercent(score, total);

        const durationSeconds =
          typeof totals.timeSpentSec === "number"
            ? totals.timeSpentSec
            : 0;

        const ts =
          raw.createdAt || raw.generatedAt || raw.timestamp || null;
        const timestamp = toDateMaybe(ts);

        const sectionId = raw.sectionId || null;
        const title =
          raw.title || raw.sectionTitle || sectionId || "Practice";

        return {
          id: raw.id || raw.attemptId || "fs_" + timestamp.getTime(),
          timestamp,
          score,
          total,
          percent,
          durationSeconds,
          title,
          sectionId,
          synced: true
        };
      }

      // Case 2: localStorage record from quiz-engine.js recordLocalAttempt
      // shape: { id, sectionId, title, timestamp, score, total, percent, durationSeconds }
      if (
        raw &&
        typeof raw.score === "number" &&
        typeof raw.total === "number"
      ) {
        const score = raw.score;
        const total = raw.total;
        const percent =
          typeof raw.percent === "number"
            ? raw.percent
            : computePercent(score, total);

        const durationSeconds =
          typeof raw.durationSeconds === "number"
            ? raw.durationSeconds
            : 0;

        const timestamp = toDateMaybe(raw.timestamp);
        const title =
          raw.title || raw.sectionId || "Practice";

        return {
          id: raw.id || "local_" + timestamp.getTime(),
          timestamp,
          score,
          total,
          percent,
          durationSeconds,
          title,
          sectionId: raw.sectionId || null,
          synced: fromFirestore ? true : false
        };
      }

      // Fallback: super minimal
      const fallbackTime = toDateMaybe(raw && raw.timestamp);
      return {
        id: (raw && raw.id) || "unknown_" + fallbackTime.getTime(),
        timestamp: fallbackTime,
        score: 0,
        total: 0,
        percent: 0,
        durationSeconds: 0,
        title: "Practice",
        sectionId: null,
        synced: fromFirestore
      };
    }

    // -----------------------------
    // Data loading: Firestore + local
    // -----------------------------
    async function fetchAllResults() {
      let firestoreAttempts = [];
      let localAttempts = [];
      let hasUnsynced = false;

      // 1) Firestore attempts via quizData (if available)
      if (
        window.quizData &&
        typeof window.quizData.loadAllResultsForUser === "function"
      ) {
        try {
          const rawFs =
            (await window.quizData.loadAllResultsForUser()) || [];
          firestoreAttempts = rawFs.map((r) =>
            normalizeAttempt(r, { fromFirestore: true })
          );
        } catch (err) {
          console.error(
            "progress.js: failed to load Firestore attempts",
            err
          );
        }
      }

      // 2) Local attempts via ATTEMPT_KEY (quiz-engine.js)
      try {
        const raw = localStorage.getItem(ATTEMPT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            localAttempts = parsed.map((r) =>
              normalizeAttempt(r, { fromFirestore: false })
            );
          }
        }
      } catch (err) {
        console.warn(
          "progress.js: failed to read local attempts from storage",
          err
        );
      }

      // Merge + sort newest → oldest
      const all = [...firestoreAttempts, ...localAttempts].sort(
        (a, b) => b.timestamp - a.timestamp
      );

      hasUnsynced =
        localAttempts.length > 0 &&
        localAttempts.some((r) => !r.synced);

      return {
        list: all,
        hasUnsynced
      };
    }

    // -----------------------------
    // Rendering
    // -----------------------------
    function renderSummary(list) {
      if (!list || !list.length) {
        summaryEl.innerHTML = `
          <div class="empty-state">
            <h2>No practice data yet</h2>
            <p>Take a quiz like <strong>Circles — Practice</strong>, then come back to see your progress.</p>
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
        const percent =
          total > 0 ? computePercent(score, total) : 0;

        totalQuestions += total;
        totalCorrect += score;
        totalTime += Number(r.durationSeconds || 0);
        if (percent > bestPercent) bestPercent = percent;
      });

      const avgPercent =
        totalQuestions > 0
          ? computePercent(totalCorrect, totalQuestions)
          : 0;

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
            <div class="hint">Approximate time on practice.</div>
          </div>
        </div>
      `;
    }

    function renderHistory(list) {
      if (!historyTable) {
        // Simple tbody-only layout
        historyBody.innerHTML = "";
      } else {
        // Ensure table is visible if we use it
        historyTable.style.display = "";
      }

      if (!list || !list.length) {
        historyBody.innerHTML = `
          <tr>
            <td colspan="5">No quizzes recorded yet.</td>
          </tr>
        `;
        return;
      }

      const rows = list.map((r) => {
        const dateStr = r.timestamp.toLocaleString();
        const percentStr = `${r.percent.toFixed(1)}%`;
        const unsyncedIcon = r.synced ? "" : " ⚠";

        return `
          <tr>
            <td class="cell-date">${escapeHtml(dateStr)}</td>
            <td class="cell-title">${escapeHtml(
              r.title || "Practice"
            )}${unsyncedIcon}</td>
            <td class="cell-score">
              <span class="score-pill">${escapeHtml(percentStr)}</span>
            </td>
            <td class="cell-detail">${r.score || 0} / ${
          r.total || 0
        }</td>
            <td class="cell-time">${secToHMS(
              r.durationSeconds
            )}</td>
          </tr>
        `;
      });

      historyBody.innerHTML = rows.join("");
    }

    // -----------------------------
    // Export / Clear
    // -----------------------------
    function wireControls() {
      if (exportBtn) {
        exportBtn.addEventListener("click", function () {
          try {
            const data = JSON.stringify(state.attempts, null, 2);
            const blob = new Blob([data], {
              type: "application/json"
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "dreamschool-progress.json";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          } catch (err) {
            console.error("progress.js: export failed", err);
            alert(
              "Could not export data. Please check the console for details."
            );
          }
        });
      }

      if (clearBtn) {
        clearBtn.addEventListener("click", function () {
          const ok = window.confirm(
            "Clear all locally saved quiz attempts on this browser? Cloud-synced results in your account will not be deleted."
          );
          if (!ok) return;

          try {
            localStorage.removeItem(ATTEMPT_KEY);
          } catch (err) {
            console.warn(
              "progress.js: failed to clear local attempts",
              err
            );
          }

          // Reload from Firestore only
          refresh().catch(() => {});
        });
      }
    }

    // -----------------------------
    // Main refresh
    // -----------------------------
    async function refresh() {
      try {
        if (loadingEl) loadingEl.style.display = "block";
        if (unsyncedEl) unsyncedEl.style.display = "none";

        const { list, hasUnsynced } = await fetchAllResults();
        state.attempts = list;

        renderSummary(list);
        renderHistory(list);

        if (unsyncedEl) {
          unsyncedEl.style.display = hasUnsynced ? "block" : "none";
        }
      } catch (err) {
        console.error("progress.js: refresh failed", err);
        summaryEl.innerHTML =
          "<p>Could not load your progress. Please try again later.</p>";
        historyBody.innerHTML =
          '<tr><td colspan="5">Error loading results.</td></tr>';
      } finally {
        if (loadingEl) loadingEl.style.display = "none";
      }
    }

    // -----------------------------
    // Init
    // -----------------------------
    function init() {
      wireControls();
      refresh().catch((err) =>
        console.error("progress.js: initial refresh failed", err)
      );
    }

    init();
  });
})();
