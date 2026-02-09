// /assets/js/progress.js
// "My Progress" page:
//
// Primary source of truth: Firestore attempts saved by attempt-writer.js:
//   users/{uid}/attempts/{attemptId}
//
// Diagnostics only:
// - Counts localStorage keys dsa:attempt:* (unsynced attempts)
// - Reads dsa:lastWrite (last write error/status written by attempt-writer)
//
// UI:
// - Hyperlink on quiz title -> /pages/review.html?attemptId=...
// - Renders 7 columns by default (adds Type badge):
//   Date | Type | Quiz | Score | Total | % Correct | Duration
//
// If your table is still 6 columns, set INCLUDE_TYPE_COL=false below
// or update your HTML header to include the Type column.

(function () {
  "use strict";

  if (window.__dsa_progress_initialized) return;
  window.__dsa_progress_initialized = true;

  // ---------
  // Config
  // ---------
  const INCLUDE_TYPE_COL = true; // set false if your HTML table has only 6 columns
  const PRIMARY_SUBCOL = "attempts";
  const FALLBACK_SUBCOLS = ["examAttempts", "results"]; // legacy/optional
  const MAX_DOCS = 300;

  document.addEventListener("DOMContentLoaded", function () {
    const summaryEl = document.getElementById("summary");
    const historyTable = document.getElementById("historyTable");
    const historyBody =
      document.getElementById("historyBody") ||
      (historyTable ? historyTable.querySelector("tbody") : null);

    const loadingEl = document.getElementById("progressLoading");
    const bannerEl = document.getElementById("unsyncedBanner");

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

    function escapeHtml(str) {
      if (str == null) return "";
      return String(str).replace(/[&<>"']/g, (m) => {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
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

      // Firestore Timestamp
      if (typeof ts?.toDate === "function") {
        try {
          const d = ts.toDate();
          return d instanceof Date ? d : null;
        } catch {
          return null;
        }
      }

      // Some code stores ms epoch
      if (typeof ts === "number") {
        const d = new Date(ts);
        return Number.isNaN(d.getTime()) ? null : d;
      }

      return null;
    }

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

    function computePercent(correct, total) {
      const c = Number(correct);
      const t = Number(total);
      if (!Number.isFinite(t) || t <= 0) return 0;
      if (!Number.isFinite(c) || c < 0) return 0;
      return Math.round((c / t) * 1000) / 10;
    }

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
        msg.includes("no user")
      );
    }

    // -----------------------------
    // Local diagnostics (unsynced attempts + last write error)
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

    function readLastWrite() {
      // attempt-writer.js should set something like:
      // localStorage.setItem("dsa:lastWrite", JSON.stringify({ ok, code, message, at, attemptId }))
      try {
        const raw = localStorage.getItem("dsa:lastWrite");
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return null;
        return obj;
      } catch {
        return null;
      }
    }

    // -----------------------------
    // Firebase bootstrap
    // -----------------------------

    async function getFirebaseApis() {
      const mod = await import("/assets/js/firebase-init.js");
      const { auth, db, authReady } = mod;

      const fs = await import(
        "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js"
      );
      const {
        collection,
        getDocs,
        orderBy,
        limit,
        query,
      } = fs;

      return { auth, db, authReady, collection, getDocs, orderBy, limit, query };
    }

    async function requireSignedInUserOrThrow(firebase) {
      await firebase.authReady;
      const user = firebase.auth.currentUser;
      if (user) return user;
      const e = new Error("Not signed in");
      e.code = "auth/no-current-user";
      throw e;
    }

    // -----------------------------
    // Attempt normalization (match attempt-writer schema)
    // -----------------------------

    function normalizeAttempt(raw, fallbackDocId) {
      const a = raw || {};
      const totals = a.totals || {};
      const items = Array.isArray(a.items) ? a.items : [];

      const total = Number.isFinite(totals.total)
        ? totals.total
        : (Number(a.total ?? a.numQuestions ?? items.length) || 0);

      const correct = Number.isFinite(totals.correct)
        ? totals.correct
        : (Number(a.correct ?? a.numCorrect ?? a.score) || 0);

      const answered = Number.isFinite(totals.answered)
        ? totals.answered
        : (Number(a.answered ?? items.length) || items.length);

      const durationSeconds = Number.isFinite(totals.timeSpentSec)
        ? totals.timeSpentSec
        : (Number(a.timeSpentSec ?? a.durationSeconds ?? a.durationSec) || 0);

      const percent = Number.isFinite(totals.scorePercent)
        ? totals.scorePercent
        : (Number.isFinite(a.scorePercent) ? a.scorePercent : computePercent(correct, total));

      const attemptId = String(a.attemptId || a.id || fallbackDocId || "");

      const quizId = String(a.quizId || a.sectionId || a.examType || "");
      const title = String(a.title || a.sectionTitle || quizId || "Practice");

      const attemptType = String(a.attemptType || (a.mode === "random" ? "random" : "topic") || "");

      const createdLike =
        a.createdAt ||
        a.generatedAt ||
        a.completedAt ||
        a.timestamp ||
        a.updatedAt ||
        null;

      const dateObj = toDateMaybe(createdLike);

      return {
        attemptId,
        quizId,
        title,
        attemptType,
        timestamp: dateObj || new Date(0),
        score: correct,
        answered,
        total,
        percent,
        durationSeconds,
      };
    }

    // -----------------------------
    // Firestore fetch logic
    // -----------------------------

    async function fetchFromSubcollection(firebase, uid, subcolName) {
      const colRef = firebase.collection(firebase.db, "users", uid, subcolName);

      // Best case: server-side order by createdAt desc
      try {
        const q = firebase.query(
          colRef,
          firebase.orderBy("createdAt", "desc"),
          firebase.limit(MAX_DOCS)
        );
        const snap = await firebase.getDocs(q);
        const rows = [];
        snap.forEach((docSnap) => rows.push(normalizeAttempt(docSnap.data(), docSnap.id)));
        return rows;
      } catch (e) {
        // Fallback: no orderBy (works if field missing / index issues)
        const snap = await firebase.getDocs(colRef);
        const rows = [];
        snap.forEach((docSnap) => rows.push(normalizeAttempt(docSnap.data(), docSnap.id)));
        return rows;
      }
    }

    async function fetchAttempts(firebase) {
      const user = await requireSignedInUserOrThrow(firebase);

      // Writer path first
      const ordered = [PRIMARY_SUBCOL].concat(FALLBACK_SUBCOLS);

      for (const subcol of ordered) {
        const rows = await fetchFromSubcollection(firebase, user.uid, subcol);
        if (rows && rows.length) {
          rows.sort((x, y) => (y.timestamp?.getTime?.() || 0) - (x.timestamp?.getTime?.() || 0));
          return { rows, foundIn: subcol };
        }
      }

      return { rows: [], foundIn: PRIMARY_SUBCOL };
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

      const colspan = INCLUDE_TYPE_COL ? 7 : 6;
      historyBody.innerHTML = `<tr><td colspan="${colspan}">No data to display.</td></tr>`;
    }

    function renderSummary(list) {
      if (!list || !list.length) {
        summaryEl.innerHTML = `
          <div class="empty-state">
            <h2>No practice data yet</h2>
            <p>Complete a quiz while signed in, then return here to see your progress.</p>
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
            <div class="hint">Each completed attempt counts once.</div>
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

    function typeBadgeHtml(type) {
      const t = String(type || "").toLowerCase();
      const label = t === "random" ? "Random" : "Topic";
      const cls = t === "random" ? "type-pill type-random" : "type-pill type-topic";
      return `<span class="${cls}">${escapeHtml(label)}</span>`;
    }

    function renderHistory(list) {
      if (historyTable) historyTable.style.display = "";

      const colspan = INCLUDE_TYPE_COL ? 7 : 6;

      if (!list || !list.length) {
        historyBody.innerHTML = `<tr><td colspan="${colspan}">No quizzes recorded yet.</td></tr>`;
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

          const cells = [];

          cells.push(`<td class="cell-date">${escapeHtml(dateStr)}</td>`);

          if (INCLUDE_TYPE_COL) {
            cells.push(`<td class="cell-type">${typeBadgeHtml(r.attemptType)}</td>`);
          }

          cells.push(`<td class="cell-title">${titleHtml}</td>`);
          cells.push(`<td class="cell-score"><span class="score-pill">${escapeHtml(pctStr)}</span></td>`);
          cells.push(`<td class="cell-total">${Number(r.score || 0)} / ${Number(r.total || 0)}</td>`);
          cells.push(`<td class="cell-pct">${escapeHtml(pctStr)}</td>`);
          cells.push(`<td class="cell-time">${escapeHtml(secToHMS(r.durationSeconds))}</td>`);

          return `<tr>${cells.join("")}</tr>`;
        })
        .join("");
    }

    function renderSignedOut(localCount) {
      const extra =
        localCount > 0
          ? ` (Note: ${localCount} local attempt${localCount === 1 ? "" : "s"} exist on this device but aren’t saved to your account.)`
          : "";

      showBanner("warning", `Sign in to your account to see your saved progress${extra}`);

      const colspan = INCLUDE_TYPE_COL ? 7 : 6;

      summaryEl.innerHTML = `
        <div class="empty-state">
          <h2>Progress unavailable</h2>
          <p>Sign in to your account to see your saved progress${escapeHtml(extra)}</p>
          <p><a class="btn" href="/profile/login.html">Log in / Sign up</a></p>
        </div>
      `;

      historyBody.innerHTML = `<tr><td colspan="${colspan}">No data to display.</td></tr>`;
    }

    function renderPermissionDenied(localCount, lastWrite) {
      const extra =
        localCount > 0
          ? ` Local attempts exist (${localCount}) but Firestore access is blocked.`
          : "";

      let lw = "";
      if (lastWrite && lastWrite.ok === false) {
        const code = lastWrite.code ? ` (${lastWrite.code})` : "";
        lw = ` Last write error${code}: ${lastWrite.message || "Unknown error"}.`;
      }

      showBanner(
        "warning",
        `Signed in, but Firestore rules are blocking access to your progress (permission denied).${extra}${lw}`
      );

      const colspan = INCLUDE_TYPE_COL ? 7 : 6;

      summaryEl.innerHTML = `
        <div class="empty-state">
          <h2>Progress unavailable</h2>
          <p>Your account is signed in, but Firestore rules are blocking access to your progress.</p>
          <p class="muted">
            Fix: allow the signed-in user to read <code>users/{uid}/${escapeHtml(PRIMARY_SUBCOL)}</code>.
          </p>
        </div>
      `;

      historyBody.innerHTML = `<tr><td colspan="${colspan}">No data to display.</td></tr>`;
    }

    function maybeShowLocalDiagnostics(rows, localCount, lastWrite) {
      // If we have Firestore rows, keep banner focused on success.
      if (rows && rows.length) return;

      if (localCount > 0) {
        let msg =
          `No Firestore attempts found, but ${localCount} local attempt${localCount === 1 ? "" : "s"} exist on this device. ` +
          `This usually means the quiz couldn’t write to Firestore (rules) or you weren’t signed in when finishing.`;

        if (lastWrite && lastWrite.ok === false) {
          const code = lastWrite.code ? ` (${lastWrite.code})` : "";
          msg += ` Last write error${code}: ${lastWrite.message || "Unknown error"}.`;
        }

        showBanner("info", msg);
      } else {
        showBanner("info", "No attempts recorded yet. Complete a quiz while signed in to start tracking progress.");
      }
    }

    // -----------------------------
    // Main refresh
    // -----------------------------

    async function refresh() {
      const localCount = countLocalAttemptKeys();
      const lastWrite = readLastWrite();

      try {
        setLoading(true);
        showBanner(null, "");

        const firebase = await getFirebaseApis();
        await requireSignedInUserOrThrow(firebase);

        const { rows, foundIn } = await fetchAttempts(firebase);
        state.attempts = rows;

        renderSummary(rows);
        renderHistory(rows);

        if (rows.length) {
          showBanner(
            "success",
            `Loaded ${rows.length} attempt${rows.length === 1 ? "" : "s"} from Firestore (${foundIn}).`
          );
        } else {
          maybeShowLocalDiagnostics(rows, localCount, lastWrite);
        }
      } catch (err) {
        console.error("progress.js: refresh failed", err);

        const localCount2 = countLocalAttemptKeys();
        const lastWrite2 = readLastWrite();

        if (isNotSignedIn(err)) {
          renderSignedOut(localCount2);
          return;
        }

        if (isPermissionDenied(err)) {
          renderPermissionDenied(localCount2, lastWrite2);
          return;
        }

        const msg =
          localCount2 > 0
            ? `Could not load your progress from Firestore. (${localCount2} local attempt${localCount2 === 1 ? "" : "s"} exist on this device.)`
            : "Could not load your progress. Please try again later.";

        // Include last write if available
        let msg2 = msg;
        if (lastWrite2 && lastWrite2.ok === false) {
          const code = lastWrite2.code ? ` (${lastWrite2.code})` : "";
          msg2 += ` Last write error${code}: ${lastWrite2.message || "Unknown error"}.`;
        }

        showBanner("warning", msg2);
        renderEmptyState(msg2);
      } finally {
        setLoading(false);
      }
    }

    refresh().catch((err) => console.error("progress.js: initial refresh failed", err));
  });
})();
