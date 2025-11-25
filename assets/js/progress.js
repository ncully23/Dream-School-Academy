// /assets/js/progress.js
(function () {
  "use strict";

  // Shared key (set by quiz-engine.js); fall back if needed
  const ATTEMPT_KEY =
    window.DSA_ATTEMPT_KEY || "dreamschool:attempts:v1";

  // -------------
  // DOM cache
  // -------------
  const el = {
    summary: document.getElementById("summary"),
    historyTable: document.getElementById("historyTable"),
    exportBtn: document.getElementById("exportBtn"),
    clearBtn: document.getElementById("clearBtn")
  };

  // -------------
  // Data helpers
  // -------------
  function loadAttempts() {
    try {
      const raw = localStorage.getItem(ATTEMPT_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      // Sort newest first
      return list
        .filter((r) => r && r.timestamp)
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() -
            new Date(a.timestamp).getTime()
        );
    } catch (e) {
      console.warn("progress.js: bad attempts JSON", e);
      return [];
    }
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function formatDuration(sec) {
    if (!sec || sec <= 0) return "—";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s.toString().padStart(2, "0")}s`;
  }

  // -------------
  // Render summary cards
  // -------------
  function renderSummary(attempts) {
    if (!el.summary) return;

    if (!attempts.length) {
      el.summary.innerHTML = `
        <div class="empty-state">
          <h2>No practice data yet</h2>
          <p>Take a quiz like <strong>Circles — Practice</strong>, then come back to see your progress.</p>
        </div>
      `;
      return;
    }

    const totalAttempts = attempts.length;
    let totalQuestions = 0;
    let totalCorrect = 0;
    let bestPercent = 0;
    let totalTime = 0;

    attempts.forEach((a) => {
      const correct = Number(a.score || 0);
      const total = Number(a.total || 0);
      const percent =
        total > 0 ? Math.round((correct / total) * 10000) / 100 : 0;

      totalQuestions += total;
      totalCorrect += correct;
      totalTime += Number(a.durationSeconds || 0);
      if (percent > bestPercent) bestPercent = percent;
    });

    const avgPercent =
      totalQuestions > 0
        ? Math.round((totalCorrect / totalQuestions) * 10000) / 100
        : 0;

    el.summary.innerHTML = `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="label">Total quizzes</div>
          <div class="value">${totalAttempts}</div>
          <div class="hint">Each completed module (like Circles) counts once.</div>
        </div>

        <div class="summary-card">
          <div class="label">Average score</div>
          <div class="value">${avgPercent.toFixed(1)}%</div>
          <div class="hint">Based on all questions answered.</div>
        </div>

        <div class="summary-card">
          <div class="label">Best score</div>
          <div class="value">${bestPercent.toFixed(1)}%</div>
          <div class="hint">Highest score on any single quiz.</div>
        </div>

        <div class="summary-card">
          <div class="label">Total time spent</div>
          <div class="value">${formatDuration(totalTime)}</div>
          <div class="hint">Approximate time across all modules.</div>
        </div>
      </div>
    `;
  }

  // -------------
  // Render history table
  // -------------
  function renderHistory(attempts) {
    if (!el.historyTable) return;

    let tbody = el.historyTable.querySelector("tbody");
    if (!tbody) {
      tbody = document.createElement("tbody");
      el.historyTable.appendChild(tbody);
    }
    tbody.innerHTML = "";

    if (!attempts.length) {
      // Optionally hide table if no attempts
      el.historyTable.style.display = "none";
      return;
    }

    el.historyTable.style.display = "";

    attempts.forEach((a) => {
      const tr = document.createElement("tr");

      const percent =
        a.total > 0
          ? Math.round((a.score / a.total) * 10000) / 100
          : 0;

      tr.innerHTML = `
        <td class="cell-date">${formatDate(a.timestamp)}</td>
        <td class="cell-title">${a.title || a.sectionId || "Quiz"}</td>
        <td class="cell-score">
          <span class="score-pill">${percent.toFixed(1)}%</span>
        </td>
        <td class="cell-detail">${a.score || 0} / ${a.total || 0}</td>
        <td class="cell-time">${formatDuration(a.durationSeconds)}</td>
      `;

      tbody.appendChild(tr);
    });
  }

  // -------------
  // Export / Clear
  // -------------
  function wireControls(attemptsRef) {
    if (el.exportBtn) {
      el.exportBtn.addEventListener("click", () => {
        try {
          const data = JSON.stringify(attemptsRef.current, null, 2);
          const blob = new Blob([data], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "dreamschool-progress.json";
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch (e) {
          console.error("progress.js: export failed", e);
          alert("Could not export data. Check console for details.");
        }
      });
    }

    if (el.clearBtn) {
      el.clearBtn.addEventListener("click", () => {
        const ok = window.confirm(
          "Clear all saved progress from this browser? This cannot be undone."
        );
        if (!ok) return;

        try {
          localStorage.removeItem(ATTEMPT_KEY);
        } catch (e) {
          console.warn("progress.js: failed to clear localStorage", e);
        }
        attemptsRef.current = [];
        renderSummary(attemptsRef.current);
        renderHistory(attemptsRef.current);
      });
    }
  }

  // -------------
  // Init
  // -------------
  function init() {
    const attemptsRef = { current: loadAttempts() };

    renderSummary(attemptsRef.current);
    renderHistory(attemptsRef.current);
    wireControls(attemptsRef);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
