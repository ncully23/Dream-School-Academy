// /assets/js/pages/progresspage.js
// Renders progress from localStorage (dsa:attempt:*) and optionally Firestore via window.quizData.

function $(id) {
  return document.getElementById(id);
}

function safeParse(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return "—"; }
}

function fmtDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return s ? `${m}m ${String(r).padStart(2, "0")}s` : "—";
}

function pct(correct, total) {
  const t = Number(total) || 0;
  const c = Number(correct) || 0;
  return t > 0 ? Math.round((c / t) * 100) : 0;
}

function getLocalAttempts() {
  const attempts = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith("dsa:attempt:")) continue;

    const data = safeParse(localStorage.getItem(k));
    if (!data || !data.attemptId) continue;

    attempts.push({
      source: "local",
      ...data
    });
  }
  return attempts;
}

function normalizeAttempt(a) {
  // Accept both your new summary shape and a few common variants.
  const totals = a.totals || {};
  const total = Number(totals.total ?? a.total ?? (Array.isArray(a.items) ? a.items.length : 0)) || 0;
  const correct = Number(totals.correct ?? a.correct) || 0;
  const answered = Number(totals.answered ?? a.answered) || 0;
  const timeSpentSec = Number(totals.timeSpentSec ?? a.timeSpentSec) || 0;

  const quizId = a.quizId || a.sectionId || a.meta?.quizId || "";
  const title = a.title || a.sectionTitle || a.meta?.title || quizId || "Quiz";

  return {
    attemptId: a.attemptId,
    quizId,
    title,
    generatedAt: a.generatedAt || a.completedAt || a.createdAt || "",
    totals: { total, correct, answered, timeSpentSec },
    raw: a,
    source: a.source || "unknown"
  };
}

async function getRemoteAttemptsIfAvailable() {
  const qd = window.quizData;
  if (!qd) return [];

  // Try a few likely APIs without assuming your exact naming.
  const fns = [
    qd.listAttempts,
    qd.getAttempts,
    qd.fetchAttempts
  ].filter((fn) => typeof fn === "function");

  if (fns.length === 0) return [];

  try {
    const res = await fns[0].call(qd);
    if (Array.isArray(res)) {
      return res.map((x) => ({ source: "remote", ...x }));
    }
    // if wrapped
    if (res && Array.isArray(res.attempts)) {
      return res.attempts.map((x) => ({ source: "remote", ...x }));
    }
    return [];
  } catch (e) {
    console.warn("progresspage: remote attempts load failed", e);
    return [];
  }
}

function mergeAttempts(localList, remoteList) {
  // Dedupe by attemptId; prefer remote if both exist.
  const map = new Map();
  for (const a of localList) map.set(a.attemptId, a);
  for (const a of remoteList) map.set(a.attemptId, a);
  return Array.from(map.values());
}

function sortNewestFirst(list) {
  return list.sort((a, b) => {
    const ta = Date.parse(a.generatedAt || "") || 0;
    const tb = Date.parse(b.generatedAt || "") || 0;
    return tb - ta;
  });
}

function renderSummary(attempts) {
  const el = $("summary");
  if (!el) return;

  const n = attempts.length;
  const totals = attempts.reduce((acc, a) => {
    const t = a.totals || {};
    acc.total += Number(t.total) || 0;
    acc.correct += Number(t.correct) || 0;
    acc.time += Number(t.timeSpentSec) || 0;

    const p = pct(t.correct, t.total);
    acc.best = Math.max(acc.best, p);
    return acc;
  }, { total: 0, correct: 0, time: 0, best: 0 });

  const avg = totals.total ? Math.round((totals.correct / totals.total) * 100) : 0;

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
      <div class="stat-value">${totals.best}%</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Time Practiced</div>
      <div class="stat-value">${fmtDuration(totals.time)}</div>
    </div>
  `;
}

function renderTable(attempts) {
  const body = $("historyBody");
  if (!body) return;

  body.innerHTML = "";

  if (attempts.length === 0) {
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

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(a.generatedAt)}</td>
      <td>${a.title}</td>
      <td>${t.correct}</td>
      <td>${t.total}</td>
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

  closeBtn.addEventListener("click", () => modal.close());

  tbody.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (a) return; // don't intercept review link clicks

    const row = e.target.closest("tr");
    if (!row) return;

    const idx = Array.from(tbody.children).indexOf(row);
    if (idx < 0 || idx >= attempts.length) return;

    pre.textContent = JSON.stringify(attempts[idx].raw, null, 2);
    modal.showModal();
  });
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

async function init() {
  setLoading(true);

  const localRaw = getLocalAttempts();
  const remoteRaw = await getRemoteAttemptsIfAvailable();

  const normalizedLocal = localRaw.map(normalizeAttempt);
  const normalizedRemote = remoteRaw.map((x) => normalizeAttempt({ source: "remote", ...x }));

  const merged = mergeAttempts(normalizedLocal, normalizedRemote);
  const sorted = sortNewestFirst(merged);

  renderSummary(sorted);
  renderTable(sorted);
  wireModal(sorted);

  // Show unsynced banner if:
  // - you have local attempts
  // - and there is *some* auth presence + remote loader exists
  // - but remote does not contain them all
  const hasRemoteSupport = typeof window.quizData?.listAttempts === "function"
    || typeof window.quizData?.getAttempts === "function"
    || typeof window.quizData?.fetchAttempts === "function";

  const localCount = normalizedLocal.length;
  const remoteCount = normalizedRemote.length;

  // If you prefer "signed-in only", update this when your shell exposes auth state.
  setUnsyncedBanner(hasRemoteSupport && localCount > remoteCount && localCount > 0);

  setLoading(false);
}

init().catch((e) => {
  console.error("progresspage: init failed", e);
  setLoading(false);
});
