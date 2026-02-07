// /assets/js/pages/reviewpage.js
// Canonical review renderer for Dream School Academy
// - supports ?attemptId=...
// - falls back to most recent dsa:attempt:*
// - renders rich solutions (steps, mistakes, checks, takeaway)
// - MathJax-safe if present

/* -----------------------------
   URL + storage helpers
------------------------------ */

function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getAttemptKey(attemptId) {
  return `dsa:attempt:${attemptId}`;
}

function findLatestAttemptId() {
  let bestId = null;
  let bestTime = -1;

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith("dsa:attempt:")) continue;

    const parsed = safeJsonParse(localStorage.getItem(k));
    const t = Date.parse(parsed?.generatedAt || "") || 0;

    if (t > bestTime) {
      bestTime = t;
      bestId = k.replace("dsa:attempt:", "");
    }
  }

  return bestId;
}

function loadAttempt(attemptId) {
  if (!attemptId) return null;
  return safeJsonParse(localStorage.getItem(getAttemptKey(attemptId)));
}

/* -----------------------------
   Small utilities
------------------------------ */

const $ = (id) => document.getElementById(id);

const letter = (i) => String.fromCharCode(65 + i);

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function asArray(x) {
  return Array.isArray(x) ? x : (x ? [x] : []);
}

function normalizeSolution(it) {
  const sol = typeof it?.solution === "object" ? it.solution : {};
  return {
    finalAnswer: sol.finalAnswer ?? null,
    approach: sol.approach ?? null,
    formulas: asArray(sol.formulas),
    steps: asArray(sol.steps),
    commonMistakes: asArray(sol.commonMistakes),
    checks: asArray(sol.checks),
    takeaway: sol.takeaway ?? null
  };
}

function showEmpty(message) {
  const header = $("headerCard");
  const empty = $("empty");
  if (header) header.style.display = "none";
  if (empty) {
    empty.style.display = "block";
    const p = empty.querySelector("p.muted") || empty.querySelector("p");
    if (p && message) p.textContent = message;
  }
}

/* -----------------------------
   Main render
------------------------------ */

function renderAttempt(summary, attemptIdFromUrl) {
  const qsEl = $("qs");
  const titleEl = $("title");
  const metaEl = $("meta");
  const pillEl = $("scorePill");
  const chipsEl = $("chips");
  const actionsEl = $("actions");
  const backToQuiz = $("backToQuiz");
  const header = $("headerCard");

  if (!qsEl || !titleEl || !metaEl || !pillEl || !header) {
    console.error("reviewpage.js: missing required DOM nodes");
    return;
  }

  const items = Array.isArray(summary?.items) ? summary.items : [];
  if (!items.length) {
    showEmpty("No attempt found. Finish a quiz first.");
    return;
  }

  header.style.display = "block";

  /* ----- totals ----- */

  const total = summary.totals?.total ?? items.length;
  const answered =
    summary.totals?.answered ??
    items.filter(i => i.chosenIndex != null).length;

  const correct =
    summary.totals?.correct ??
    items.reduce((n, it) => {
      return n + (
        it.chosenIndex != null &&
        it.correctIndex != null &&
        it.chosenIndex === it.correctIndex
          ? 1 : 0
      );
    }, 0);

  const scorePct =
    summary.totals?.scorePercent ??
    (total ? Math.round((correct / total) * 100) : 0);

  const finishedAt = summary.generatedAt || new Date().toISOString();
  const timeLabel = formatDuration(summary.totals?.timeSpentSec || 0);

  /* ----- header ----- */

  const titleText = summary.title || summary.sectionTitle || "Review";
  document.title = titleText;
  titleEl.textContent = titleText;

  metaEl.textContent =
    `Answered ${answered}/${total} • Correct ${correct} • ` +
    `Time ${timeLabel} • Completed ${new Date(finishedAt).toLocaleString()}`;

  pillEl.innerHTML = `<span>${scorePct}%</span><span class="small">Score</span>`;

  if (chipsEl) {
    chipsEl.innerHTML = "";
    if (summary.quizId)
      chipsEl.insertAdjacentHTML("beforeend",
        `<span class="chip">quizId: ${summary.quizId}</span>`);
    if (attemptIdFromUrl)
      chipsEl.insertAdjacentHTML("beforeend",
        `<span class="chip">attemptId: ${attemptIdFromUrl}</span>`);
  }

  if (actionsEl && backToQuiz && summary.quizId) {
    actionsEl.style.display = "flex";
    backToQuiz.href = `/pages/quiz.html?quizId=${encodeURIComponent(summary.quizId)}`;
  }

  /* ----- questions ----- */

  qsEl.innerHTML = "";

  items.forEach((it, idx) => {
    const number = it.number ?? (idx + 1);
    const choices = asArray(it.choices);

    const ci = Number.isFinite(it.correctIndex) ? it.correctIndex : null;
    const ui = Number.isFinite(it.chosenIndex) ? it.chosenIndex : null;

    const unanswered = ui == null;
    const isCorrect = !unanswered && ci != null && ui === ci;

    const sec = document.createElement("section");
    sec.className = `q ${unanswered ? "na" : (isCorrect ? "ok" : "no")}`;

    /* ----- header ----- */

    const metaBits = [];
    if (it.questionId) metaBits.push(`questionId: ${it.questionId}`);
    if (Number.isFinite(it.timeSpentSec)) metaBits.push(`time: ${it.timeSpentSec}s`);

    /* ----- choices ----- */

    const choiceHtml = choices.map((c, i) => {
      const isAns = i === ci;
      const isUser = i === ui;

      const tags = [];
      if (isUser) tags.push(`<span class="tag you">Your choice</span>`);
      if (isAns) tags.push(`<span class="tag correct">Correct</span>`);
      if (isUser && !isAns) tags.push(`<span class="tag wrong">Wrong</span>`);
      if (unanswered && isAns) tags.push(`<span class="tag unanswered">You left blank</span>`);

      return `
        <div class="choice ${isAns ? "correct" : ""} ${isUser ? "your" : ""}">
          <div><b>${letter(i)}.</b> ${c}</div>
          <div class="tags">${tags.join("")}</div>
        </div>
      `;
    }).join("");

    /* ----- solution ----- */

    const sol = normalizeSolution(it);

    let solutionHtml = `
      <ul>
        ${ci != null ? `<li><b>Correct answer:</b> ${letter(ci)}. ${choices[ci] ?? ""}</li>` : ""}
        ${unanswered
          ? `<li><b>Your answer:</b> (no answer selected)</li>`
          : `<li><b>Your answer:</b> ${letter(ui)}. ${choices[ui] ?? ""} ${isCorrect ? "(correct)" : "(incorrect)"}</li>`}
        ${it.skill ? `<li><b>Skill:</b> ${it.skill}</li>` : ""}
        ${it.difficulty ? `<li><b>Difficulty:</b> ${it.difficulty}</li>` : ""}
      </ul>
    `;

    let deep = "";

    if (
      sol.approach ||
      sol.formulas.length ||
      sol.steps.length ||
      sol.commonMistakes.length ||
      sol.checks.length ||
      sol.takeaway
    ) {
      deep = `
        <details class="deep">
          <summary>
            <span>Deep explanation</span>
            <span class="chev"></span>
          </summary>
          ${sol.approach ? `<p><b>Approach:</b> ${sol.approach}</p>` : ""}
          ${sol.formulas.length ? `<p><b>Formulas:</b></p><ul>${sol.formulas.map(f => `<li>${f}</li>`).join("")}</ul>` : ""}
          ${sol.steps.length ? `<p><b>Steps:</b></p><ol>${sol.steps.map(s => `<li>${s}</li>`).join("")}</ol>` : ""}
          ${sol.commonMistakes.length ? `<p><b>Common mistakes:</b></p><ul>${sol.commonMistakes.map(m => `<li>${m}</li>`).join("")}</ul>` : ""}
          ${sol.checks.length ? `<p><b>How to check:</b></p><ul>${sol.checks.map(c => `<li>${c}</li>`).join("")}</ul>` : ""}
          ${sol.takeaway ? `<p><b>Takeaway:</b> ${sol.takeaway}</p>` : ""}
        </details>
      `;
    }

    sec.innerHTML = `
      <div class="qhead">
        <div class="badge ${unanswered ? "na" : (isCorrect ? "ok" : "no")}">${number}</div>
        <div>
          <div class="prompt">${it.prompt || ""}</div>
          ${metaBits.length ? `<div class="submeta">${metaBits.join(" • ")}</div>` : ""}
        </div>
      </div>

      <div class="choices">${choiceHtml}</div>

      <div class="exp">
        <b>Solution:</b>
        ${solutionHtml}
        ${deep}
      </div>
    `;

    qsEl.appendChild(sec);
  });

  /* ----- MathJax ----- */
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([qsEl]).catch(() => {});
  }
}

/* -----------------------------
   Init
------------------------------ */

(function init() {
  let attemptId = getParam("attemptId");

  if (!attemptId) {
    attemptId = findLatestAttemptId();
    if (attemptId) {
      const u = new URL(location.href);
      u.searchParams.set("attemptId", attemptId);
      history.replaceState(null, "", u.toString());
    }
  }

  const summary = loadAttempt(attemptId);

  if (!summary) {
    showEmpty("No attempt found. Finish a quiz first.");
    return;
  }

  renderAttempt(summary, attemptId);
})();
