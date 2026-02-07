// /assets/js/admin/studentprogress.js
// Admin: Student progress page
// - Reads Firestore attempts from users/{uid}/examAttempts (NOT "attempts")
// - Renders attempts table
// - Review link uses the stored attemptId field (engine attemptId), with fallback to doc id
// - Keeps compat firebase.firestore() style
(function () {
  "use strict";

  // IMPORTANT: your site now stores attempts under users/{uid}/examAttempts
  const ATTEMPTS_SUBCOLLECTION = "examAttempts";
  const MAX_ATTEMPTS = 200;

  // Review page
  const REVIEW_PAGE_PATH = "/pages/review.html";

  if (window.__dsa_admin_studentprogress_initialized) return;
  window.__dsa_admin_studentprogress_initialized = true;

  document.addEventListener("DOMContentLoaded", () => {
    main().catch((err) => {
      console.error("[studentprogress] fatal:", err);
      setBanner(`Error: ${err?.message || String(err)}`, "error");
    });
  });

  async function main() {
    setBanner("", "clear");

    await waitForAdminAuth();
    await window.dsaAdminAuth.requireAdminOrRedirect();

    const uid = getRequiredParam("uid");
    if (!uid) {
      setText("studentTitle", "Student");
      setText("studentMeta", "Missing ?uid=...");
      setSummaryEmpty("Missing student UID in URL.");
      renderEmptyTable("No attempts found (missing uid).");
      return;
    }

    // compat firestore
    const db = firebase.firestore();

    await loadStudentHeader(db, uid);

    const attempts = await fetchAttemptsForUid(db, uid);

    renderSummary(attempts);
    renderHistory(attempts, uid);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitForAdminAuth(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (
        window.dsaAdminAuth &&
        typeof window.dsaAdminAuth.requireAdminOrRedirect === "function"
      ) {
        return;
      }
      await sleep(50);
    }
    throw new Error(
      "Admin auth helper missing. Ensure adminauth.js is loaded on this page."
    );
  }

  async function loadStudentHeader(db, uid) {
    const titleEl = document.getElementById("studentTitle");
    const metaEl = document.getElementById("studentMeta");
    if (!titleEl || !metaEl) return;

    try {
      const userDoc = await db.collection("users").doc(uid).get();
      if (!userDoc.exists) {
        titleEl.textContent = `Student: ${uid}`;
        metaEl.textContent = "No /users/{uid} profile doc found.";
        setBanner("User profile doc missing. Attempts may still exist.", "warn");
        return;
      }

      const profile = userDoc.data() || {};
      const name =
        safeStr(profile.displayName) ||
        safeStr(profile.name) ||
        safeStr(profile.fullName) ||
        uid;
      const email = safeStr(profile.email);

      titleEl.textContent =
        name === uid ? `Student: ${uid}` : `Student: ${name}`;
      metaEl.textContent = email ? `${email} • UID: ${uid}` : `UID: ${uid}`;
    } catch (e) {
      console.warn("[studentprogress] user profile load failed:", e);
      titleEl.textContent = `Student: ${uid}`;
      metaEl.textContent = `UID: ${uid}`;
      setBanner(
        "Could not load student profile doc. Showing attempts if available.",
        "warn"
      );
    }
  }

  async function fetchAttemptsForUid(db, uid) {
    const colRef = db
      .collection("users")
      .doc(uid)
      .collection(ATTEMPTS_SUBCOLLECTION);

    // Prefer sorting by createdAt if present; fall back to unsorted + client sort
    try {
      const snap = await colRef
        .orderBy("createdAt", "desc")
        .limit(MAX_ATTEMPTS)
        .get();
      return snapToAttempts(snap);
    } catch (e) {
      console.warn(
        "[studentprogress] orderBy(createdAt) failed, falling back:",
        e
      );
      const snap = await colRef.limit(MAX_ATTEMPTS).get();
      const attempts = snapToAttempts(snap);
      attempts.sort((a, b) => getAttemptSortTime(b) - getAttemptSortTime(a));
      return attempts;
    }
  }

  function snapToAttempts(snap) {
    const out = [];
    snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
    return out;
  }

  // -------- Rendering --------

  function renderSummary(attempts) {
    const summaryEl = document.getElementById("summary");
    if (!summaryEl) return;

    if (!attempts.length) {
      setSummaryEmpty("No attempts yet.");
      return;
    }

    const totalAttempts = attempts.length;

    // Weighted average (correct/total) is more meaningful than averaging percents.
    const agg = attempts.reduce(
      (acc, a) => {
        const { correct, total } = extractCorrectTotal(a);
        acc.correct += correct;
        acc.total += total;
        acc.best = Math.max(acc.best, total ? (correct / total) * 100 : 0);
        return acc;
      },
      { correct: 0, total: 0, best: 0 }
    );

    const avgPct = agg.total ? Math.round((agg.correct / agg.total) * 1000) / 10 : null;
    const bestPct = Number.isFinite(agg.best) ? Math.round(agg.best * 10) / 10 : null;

    summaryEl.innerHTML = `
      <div class="card">
        <div><strong>Total attempts:</strong> ${totalAttempts}</div>
        <div><strong>Average score:</strong> ${avgPct == null ? "—" : `${avgPct}%`}</div>
        <div><strong>Best score:</strong> ${bestPct == null ? "—" : `${bestPct}%`}</div>
      </div>
    `;
  }

  function renderHistory(attempts, studentUid) {
    const body = document.getElementById("historyBody");
    if (!body) throw new Error('Missing <tbody id="historyBody"> in student.html');

    body.innerHTML = "";

    if (!attempts.length) {
      body.innerHTML = `<tr><td colspan="5">No attempts found.</td></tr>`;
      return;
    }

    for (const a of attempts) {
      const date = formatAnyDate(a);

      // Prefer "title/sectionTitle", then quizId/sectionId as fallback
      const quiz =
        safeStr(a.title) ||
        safeStr(a.sectionTitle) ||
        safeStr(a.quizTitle) ||
        safeStr(a.quizId) ||
        safeStr(a.sectionId) ||
        "(unknown quiz)";

      const score = formatScore(a);
      const time = formatTimeSeconds(extractTimeSeconds(a));

      // CRITICAL: attemptId for review should be the engine attemptId field (a.attemptId),
      // not the Firestore doc id (a.id). Use doc id only as a last-resort fallback.
      const engineAttemptId = safeStr(a.attemptId) || safeStr(a.attemptID) || safeStr(a.id);

      const reviewHref = buildReviewHref(engineAttemptId, studentUid);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(date)}</td>
        <td>${escapeHtml(quiz)}</td>
        <td>${escapeHtml(score)}</td>
        <td>${escapeHtml(time)}</td>
        <td><a href="${escapeHtml(reviewHref)}">Open</a></td>
      `;
      body.appendChild(tr);
    }
  }

  function renderEmptyTable(msg) {
    const body = document.getElementById("historyBody");
    if (body) body.innerHTML = `<tr><td colspan="5">${escapeHtml(msg)}</td></tr>`;
  }

  function buildReviewHref(attemptId, studentUid) {
    const base = `${REVIEW_PAGE_PATH}?attemptId=${encodeURIComponent(attemptId)}`;
    return `${base}&uid=${encodeURIComponent(studentUid)}`;
  }

  function setSummaryEmpty(msg) {
    const summaryEl = document.getElementById("summary");
    if (summaryEl) summaryEl.innerHTML = `<p class="muted">${escapeHtml(msg)}</p>`;
  }

  // ---- scoring/time/date helpers ----

  function extractCorrectTotal(a) {
    // New shape (your site): a.totals.correct / a.totals.total
    if (a && a.totals && typeof a.totals === "object") {
      const correct = toNum(a.totals.correct);
      const total = toNum(a.totals.total);
      if (Number.isFinite(correct) || Number.isFinite(total)) {
        return {
          correct: Number.isFinite(correct) ? correct : 0,
          total: Number.isFinite(total) ? total : inferTotalFromAnswers(a)
        };
      }
    }

    // Legacy-ish fallbacks
    const correct = toNum(
      a?.numCorrect ?? a?.correct ?? a?.correctCount ?? a?.num_correct ?? a?.right ?? a?.scoreCorrect
    );
    const total = toNum(
      a?.totalQuestions ?? a?.total ?? a?.numQuestions ?? a?.questionCount ?? a?.totalCount ?? a?.num_total
    );

    const inferredTotal = Number.isFinite(total) ? total : inferTotalFromAnswers(a);
    const inferredCorrect = Number.isFinite(correct) ? correct : inferCorrectFromAnswers(a);

    return {
      correct: Number.isFinite(inferredCorrect) ? inferredCorrect : 0,
      total: Number.isFinite(inferredTotal) ? inferredTotal : 0
    };
  }

  function inferTotalFromAnswers(a) {
    const arr =
      (Array.isArray(a?.responses) && a.responses) ||
      (Array.isArray(a?.answers) && a.answers) ||
      (Array.isArray(a?.items) && a.items) ||
      null;
    return arr ? arr.length : 0;
  }

  function inferCorrectFromAnswers(a) {
    const arr =
      (Array.isArray(a?.responses) && a.responses) ||
      (Array.isArray(a?.answers) && a.answers) ||
      (Array.isArray(a?.items) && a.items) ||
      null;
    if (!arr) return null;

    let c = 0,
      seen = 0;
    for (const r of arr) {
      if (r && typeof r === "object") {
        const v = r.isCorrect ?? r.correct;
        if (typeof v === "boolean") {
          seen++;
          if (v) c++;
        }
      }
    }
    return seen ? c : null;
  }

  function formatScore(a) {
    const { correct, total } = extractCorrectTotal(a);
    if (!total && correct) return String(correct);
    if (!total) return "—";
    const pct = Math.round((correct / total) * 100);
    return `${correct}/${total} (${pct}%)`;
  }

  function extractTimeSeconds(a) {
    // New shape: a.totals.timeSpentSec
    const tsec = toNum(a?.totals?.timeSpentSec);
    if (Number.isFinite(tsec) && tsec > 0) return tsec;

    const sec = toNum(a?.timeSpentSec ?? a?.durationSec ?? a?.timeSpent ?? a?.elapsedSec ?? a?.seconds);
    if (Number.isFinite(sec) && sec > 0) return sec;

    const ms = toNum(a?.timeSpentMs ?? a?.durationMs ?? a?.elapsedMs);
    if (Number.isFinite(ms) && ms > 0) return Math.round(ms / 1000);

    return 0;
  }

  function formatTimeSeconds(sec) {
    sec = Math.max(0, Number(sec) || 0);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function formatAnyDate(a) {
    // New shape uses createdAt (Timestamp) and generatedAt (string) sometimes
    const ts =
      a?.createdAt ?? a?.generatedAt ?? a?.timestamp ?? a?.finishedAt ?? a?.endedAt ?? a?.startedAt ?? a?.startTime ?? null;
    const d = coerceToDate(ts);
    return d ? d.toLocaleString() : "(no date)";
  }

  function getAttemptSortTime(a) {
    const ts = a?.createdAt ?? a?.generatedAt ?? a?.timestamp ?? a?.finishedAt ?? a?.endedAt ?? a?.startedAt ?? null;
    const d = coerceToDate(ts);
    return d ? d.getTime() : 0;
  }

  function coerceToDate(v) {
    if (v && typeof v === "object" && typeof v.toDate === "function") {
      try {
        return v.toDate();
      } catch (_) {
        return null;
      }
    }
    if (v instanceof Date) return v;
    if (typeof v === "number") {
      if (v > 1e12) return new Date(v);
      if (v > 1e9) return new Date(v * 1000);
      return null;
    }
    if (typeof v === "string") {
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    return null;
  }

  function getRequiredParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (_) {
      return null;
    }
  }

  function setText(id, text) {
    const el = document.getElementById(id);
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

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
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
