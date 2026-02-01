// /assets/js/pages/progresspage.js
// Best-of merge (history.js + your current progresspage.js):
// - Loads attempts from localStorage (dsa:attempt:*)
// - Loads attempts from Firestore *if* window.quizData supports it
// - Optional: requires login if the page is meant to be account-bound
// - Renders summary + history table with Review links
// - Shows "unsynced" banner when local attempts exist but aren’t in remote
// - Keeps a click-row JSON modal for debugging (optional)

function $(id) {
  return document.getElementById(id);
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn("progresspage: JSON parse failed", e);
    return null;
  }
}

function fmtDate(isoOrDateLike) {
  if (!isoOrDateLike) return "—";
  try {
    return new Date(isoOrDateLike).toLocaleString();
  } catch {
    return "—";
  }
}

function fmtDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (!s) return "—";

  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);

  if (h) return `${h}h ${m}m ${r}s`;
  if (m) return `${m}m ${String(r).padStart(2, "0")}s`;
  return `${r}s`;
}

function pct(correct, total) {
  const t = Number(total) || 0;
  const c = Number(correct) || 0;
  return t > 0 ? Math.round((c / t) * 100) : 0;
}

function setLoading(isLoading) {
  const el = $("progressLoading");
  if (!el) return;
  el.style.display = isLoading ? "block" : "none";
}

function setUnsyncedBanner(show) {
  const el = $("unsyncedBanner");
  if (!el) return;
  el.style.display = show ? "block" : "none";
}

/**
 * If your shell/auth exposes a boolean on window, use it.
 * This is intentionally defensive: it won’t crash if not present.
 */
function getAuthState() {
  // Preferred: your shell.js can set window.DSA_AUTH = { user, isSignedIn }
  const a = window.DSA_AUTH;
  if (a && typeof a.isSignedIn === "boolean") return a;

  // Common fallback patterns you might add later:
  // window.currentUser, window.authUser, etc.
  if (window.currentUser) return { isSignedIn: true, user: window.currentUser };

  return { isSignedIn: false, user: null };
}

/**
 * If you want Progress to require login (like history.js did),
 * set window.pageConfig.requireLogin = true on the page.
 */
function enforceLoginIfConfigured() {
  const cfg = window.pageConfig || {};
  if (!cfg.requireLogin) return;

  const { isSignedIn } = getAuthState();
  if (!isSignedIn) {
    // Use your new route (adjust if your login URL differs)
    location.href = "/profile/login";
  }
}

// -------- Local attempts --------

function getLocalAttemptsRaw() {
  const attempts = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith("dsa:attempt:")) continue;

    const data = safeParse(localStorage.getItem(k));
    if (!data) continue;

    // attemptId should exist; if not, infer from key
    const attemptId = data.attemptId || k.replace("dsa:attempt:", "");
    attempts.push({ source: "local", attemptId, ...data });
  }
  return attempts;
}

/**
 * Normalizes multiple shapes:
 * - Your new local attempt shape: { attemptId, quizId, title, generatedAt, totals, items... }
 * - QuizData/Firestore shapes you may return later
 * - Light legacy variants
 */
function normalizeAttempt(raw) {
  const a = raw || {};
  const totals = a.totals || {};

  const itemsLen = Array.isArray(a.items) ? a.items.length : 0;

  const total = Number.isFinite(totals.total)
    ? totals.total
    : Number(a.total ?? a.numQuestions ?? itemsLen) || 0;

  const correct = Number.isFinite(totals.correct)
    ? totals.correct
    : Number(a.correct ?? a.numCorrect) || 0;

  const answered = Number.isFinite(totals.answered)
    ? totals.answered
    : Number(a.answered) || (Array.isArray(a.items) ? a.items.filter(it => it?.chosenIndex != null).length : 0);

  const timeSpentSec = Number.isFinite(totals.timeSpentSec)
    ? totals.timeSpentSec
    : Number(a.timeSpentSec ?? a.durationSeconds ?? a.durationSec) || 0;

  const attemptId =
    a.attemptId ||
    a.id ||
    a.attemptID ||
    "";

  const quizId =
    a.quizId ||
    a.sectionId ||
    a.examType ||
    a.meta?.quizId ||
    "";

  const title =
    a.title ||
    a.sectionTitle ||
    a.examType ||
    a.meta?.title ||
    quizId ||
    "Quiz";

  // Use the most likely timestamp field:
  // - your local: generatedAt
  // - old Firestore patterns: completedAt / createdAt (maybe Timestamp-like)
  let generatedAt =
    a.generatedAt ||
    a.completedAt ||
    a.createdAt ||
    a.timestamp ||
    "";

  // Firestore Timestamp objects sometimes appear here.
  if (generatedAt && typeof generatedAt?.toDate === "function") {
    generatedAt = generatedAt.toDate().toISOString();
  } else if (generatedAt instanceof Date) {
    generatedAt = generatedAt.toISOString();
  }

  return {
    attemptId: String(attemptId || ""),
    quizId: String(quizId || ""),
    title: String(title || "Quiz"),
    generatedAt: generatedAt || "",
    totals: { total, correct, answered, timeSpentSec },
    source: a.source || "unknown",
    raw: a
  };
}

// -------- Remote attempts (quizData) --------

async function getRemoteAttemptsIfAvailable() {
  const qd = window.quizData;
  if (!qd) return [];

  // We don't assume your exact API; we probe common names.
  const candidates = [
    qd.listAttempts,
    qd.getAttempts,
    qd.fetchAttempts,
    qd.loadAllResultsForUser // from your older progress tooling
  ].filter((fn) => typeof fn === "function");

  if (candidates.length === 0) return [];

  try {
    const res = await candidates[0].call(qd);

    // Allow either:
    // - array of attempts
    // - { attempts: [...] }
    // - { list: [...] }
    if (Array.isArray(res)) return res.map((x) => ({ source: "remote", ...x }));
    if (res && Array.isArray(res.attempts)) return res.attempts.map((x) => ({ source: "remote", ...x }));
    if (res && Array.isArray(res.list)) return res.list.map((x) => ({ source: "remote", ...x }));

    return [];
  } catch (e) {
    console.warn("progresspage: remote attempts load failed", e);
    return [];
  }
}

function mergeAttempts(normalizedLocal, normalizedRemote) {
  // Dedupe by attemptId; prefer remote if both exist.
  const map = new Map();

  for (const a of normalizedLocal) {
    if (!a.attemptId) continue;
    map.set(a.attemptId, a);
  }

  for (const a of normalizedRemote) {
    if (!a.attemptId) continue;
    map.set(a.attemptId, a);
  }

  return Array.from(map.values());
}

function sortNewestFirst(list) {
  return list.sort((a, b) => {
    const ta = Date.parse(a.generatedAt || "") || 0;
    const tb = Date.parse(b.generatedAt || "") || 0;
    return tb - ta;
  });
}

// -------- Rendering --------

function renderSummary(attempts) {
  const el = $("summary");
  if (!el) return;

  if (!attempts.length) {
    el.innerHTML = `
      <div class="muted" style="padding:12px;">
        No practice history yet. Take a quiz and your results will show up here.
      </div>
    `;
    return;
  }

  const n = attempts.length;

  // Weighted average (correct/total) across all attempts
  const agg = attempts.reduce(
    (acc, a) => {
      acc.total += Number(a.totals.total) || 0;
      acc.correct += Number(a.totals.correct) || 0;
      acc.time += Number(a.totals.timeSpentSec) || 0;
      acc.best = Math.max(acc.best, pct(a.totals.correct, a.totals.total));
      return acc;
    },
    { total: 0, correct: 0, time: 0, best: 0 }
  );

  const avg = agg.total ? Math.round((agg.correct / agg.total) * 100) : 0;

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Attempts</div>
      <div class="stat-value">${n}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Average</div>
      <div class="stat-value">${avg}%</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Best</div>
      <div class="stat-value">${agg.best}%</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Time Practiced</div>
      <div class="stat-value">${fmtDuration(agg.time)}</div>
    </div>
  `;
}

function renderTable(attempts) {
  const body = $("historyBody");
  if (!body) return;

  body.innerHTML = "";

  if (!attempts.length) {
    body.innerHTML = `
      <tr>
        <td colspan="7" class="muted" style="padding:14px;">
          No attempts yet. Take a quiz and your results will show up here.
        </td>
      </tr>
    `;
    return;
  }

  for (const a of attempts) {
    const t = a.totals || {};
    const p = pct(t.correct, t.total);

    // Small warning marker if local-only
    const localOnly = a.source === "local";
    const title = localOnly ? `${a.title} ⚠` : a.title;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(a.generatedAt)}</td>
      <td>${title}</td>
      <td>${Number(t.correct) || 0}</td>
      <td>${Number(t.total) || 0}</td>
      <td>${p}%</td>
      <td>${fmtDuration(t.timeSpentSec)}</td>
      <td>
        <a class="btn btn-sm" href="/pages/review.html?attemptId=${encodeURIComponent(a.attemptId)}">
          Review
        </a>
      </td>
    `;
    body.appendChild(tr);
  }
}

function wireModal(attempts) {
  // Optional: click row to open raw JSON modal (handy while building)
  const modal = $("detailsModal");
  const pre = $("detailsBody");
  const closeBtn = $("detailsClose");
  const tbody = $("historyBody");

  if (!modal || !pre || !closeBtn || !tbody) return;

  closeBtn.addEventListener("click", () => {
    try {
      modal.close();
    } catch {}
  });

  tbody.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (link) return; // don't intercept review link clicks

    const row = e.target.closest("tr");
    if (!row) return;

    const idx = Array.from(tbody.children).indexOf(row);
    if (idx < 0 || idx >= attempts.length) return;

    pre.textContent = JSON.stringify(attempts[idx].raw, null, 2);

    // <dialog> support
    if (typeof modal.showModal === "function") modal.showModal();
  });
}

// -------- Main --------

async function init() {
  enforceLoginIfConfigured();

  setLoading(true);
  setUnsyncedBanner(false);

  // local
  const localRaw = getLocalAttemptsRaw();
  const normalizedLocal = localRaw.map(normalizeAttempt).filter(a => a.attemptId);

  // remote
  const remoteRaw = await getRemoteAttemptsIfAvailable();
  const normalizedRemote = remoteRaw
    .map((x) => normalizeAttempt({ source: "remote", ...x }))
    .filter(a => a.attemptId);

  // merge + sort
  const merged = sortNewestFirst(mergeAttempts(normalizedLocal, normalizedRemote));

  renderSummary(merged);
  renderTable(merged);
  wireModal(merged);

  // Unsynced banner logic:
  // show only if:
  // - there are local attempts
  // - remote support exists
  // - and at least one local attemptId is missing from remote set
  const hasRemoteSupport =
    typeof window.quizData?.listAttempts === "function" ||
    typeof window.quizData?.getAttempts === "function" ||
    typeof window.quizData?.fetchAttempts === "function" ||
    typeof window.quizData?.loadAllResultsForUser === "function";

  const remoteIds = new Set(normalizedRemote.map(a => a.attemptId));
  const missingInRemote = normalizedLocal.some(a => !remoteIds.has(a.attemptId));

  setUnsyncedBanner(hasRemoteSupport && normalizedLocal.length > 0 && missingInRemote);

  setLoading(false);
}

init().catch((e) => {
  console.error("progresspage: init failed", e);
  setLoading(false);

  const body = $("historyBody");
  if (body) {
    body.innerHTML = `
      <tr>
        <td colspan="7" class="muted" style="padding:14px;">
          Sorry — we couldn't load your progress.
        </td>
      </tr>
    `;
  }
});
