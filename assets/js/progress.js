// /assets/js/progress.js
// "My Progress" page:
// - Shows Firestore attempts for the logged-in user.
// - Hyperlink on quiz title -> /pages/review.html?attemptId=...
// - Renders 6 columns: Date, Category, Score, Total, % Correct, Duration
// - Uses localStorage (dsa:attempt:*) ONLY as a diagnostic to detect unsynced attempts.
// - Friendly error states: signed out vs permission denied vs generic.
//
// This revision tries multiple likely Firestore subcollections to match your writer:
//   users/{uid}/attempts
//   users/{uid}/examAttempts
//   users/{uid}/results   (optional fallback)
// And uses a robust ordering fallback if createdAt isn't present.

(function () {
  "use strict";

  if (window.__dsa_progress_initialized) return;
  window.__dsa_progress_initialized = true;

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
      return Math.round((s / t) * 1000) / 10;
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

    function normalizeAttempt(raw, fallbackDocId) {
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

      const attemptId = String(a.attemptId || a.id || fallbackDocId || "");

      const sectionId = String(a.sectionId || a.quizId || a.examType || "");
      const title = String(a.title || a.sectionTitle || sectionId || "Practice");

      const createdLike = a.createdAt || a.generatedAt || a.completedAt || a.timestamp || null;
      const dateObj = toDateMaybe(createdLike);

      return {
        attemptId,
        timestamp: dateObj || new Date(0),
        score,
        total,
        percent,
        durationSeconds,
        title,
        sectionId,
      };
    }

    // Try to query a subcollection. If createdAt orderBy fails (missing index/field),
    // fall back to an unordered fetch and client-side sort.
    async function fetchFromSubcollection(firebase, uid, subcolName) {
      const colRef = firebase.collection(firebase.db, "users", uid, subcolName);

      // Primary plan: orderBy createdAt desc limit 200
      try {
        const q = firebase.query(colRef, firebase.orderBy("createdAt", "desc"), firebase.limit(200));
        const snap = await firebase.getDocs(q);
        const rows = [];
        snap.forEach((docSnap) => rows.push(normalizeAttempt(docSnap.data(), docSnap.id)));
        return rows;
      } catch (e) {
        // Fallback: no orderBy (works even if createdAt missing)
        const snap = await firebase.getDocs(colRef);
        const rows = [];
        snap.forEach((docSnap) => rows.push(normalizeAttempt(docSnap.data(), docSnap.id)));
        return rows;
      }
    }

    async function fetchAllResults(firebase) {
      const user = await requireSignedInUserOrThrow(firebase);

      // Try common writer paths in priority order
      const candidates = ["attempts", "examAttempts", "results"];
      let foundIn = null;
      let rows = [];

      for (const name of candidates) {
        const r = await fetchFromSubcollection(firebase, user.uid, name);
        if (r && r.length) {
          rows = r;
          foundIn = name;
          break;
        }
      }

      // Client-side sort by timestamp
      rows.sort((x, y) => (y.timestamp?.getTime?.() || 0) - (x.timestamp?.getTime?.() || 0));

      return { rows, foundIn };
    }

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
            Fix: allow the signed-in user to read <code>users/{uid}/attempts</code> (or your chosen attempts collection).
          </p>
        </div>
      `;
      historyBody.innerHTML = '<tr><td colspan="6">No data to display.</td></tr>';
    }

    async function refresh() {
      const localCount = countLocalAttemptKeys();
      try {
        setLoading(true);
        showBanner(null, "");

        const firebase = await getFirebaseApis();
        await requireSignedInUserOrThrow(firebase);

        const { rows, foundIn } = await fetchAllResults(firebase);
        state.attempts = rows;

        renderSummary(rows);
        renderHistory(rows);

        if (rows.length) {
          showBanner("success", `Loaded ${rows.length} attempt${rows.length === 1 ? "" : "s"} from Firestore (${foundIn}).`);
        } else if (localCount > 0) {
          showBanner(
            "info",
            `No Firestore attempts found, but ${localCount} local attempt${localCount === 1 ? "" : "s"} exist on this device. This usually means the quiz couldn't write to Firestore (rules) or you weren't signed in when finishing.`
          );
        }
      } catch (err) {
        console.error("progress.js: refresh failed", err);

        const localCount = countLocalAttemptKeys();

        if (isNotSignedIn(err)) {
          renderSignedOut(localCount);
          return;
        }

        if (isPermissionDenied(err)) {
          renderPermissionDenied(localCount);
          return;
        }

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

    refresh().catch((err) => console.error("progress.js: initial refresh failed", err));
  });
})();
