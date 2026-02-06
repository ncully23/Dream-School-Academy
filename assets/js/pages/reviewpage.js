// /assets/js/pages/reviewpage.js
// Best-of merge: your review renderer + key robustness from summary-view.js
// - supports ?attemptId=...
// - falls back to latest dsa:attempt:*
// - optional fallback keys (legacy summaries)
// - better duration formatting
// - optional MathJax typeset (if present)

function getParam(name) {
  const params = new URLSearchParams(location.search);
  return params.get(name);
}

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn("reviewpage.js: failed to parse JSON from storage", e);
    return null;
  }
}

function getAttemptKey(attemptId) {
  return `dsa:attempt:${attemptId}`;
}

/**
 * Legacy/fallback keys (temporary migration support)
 * If a user opens /review without attemptId, or you’re migrating old builds,
 * we try these keys to show *something* instead of blank.
 */
const FALLBACK_KEYS = [
  "dsa-last-summary",
  "dsa-circles-summary-v1"
];

function findLatestAttemptId() {
  // Scans localStorage for dsa:attempt:* and picks the newest by generatedAt
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("dsa:attempt:")) keys.push(k);
  }
  if (keys.length === 0) return null;

  let best = { attemptId: null, t: -1 };

  for (const k of keys) {
    const data = safeJsonParse(localStorage.getItem(k));
    const attemptId = k.replace("dsa:attempt:", "");
    const t = Date.parse(data?.generatedAt || "") || 0;
    if (t > best.t) best = { attemptId, t };
  }

  return best.attemptId;
}

function letter(i) {
  return String.fromCharCode(65 + i);
}

function formatDuration(sec) {
  // Best-of summary-view.js
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function el(id) {
  return document.getElementById(id);
}

function showEmpty(message) {
  const header = el("headerCard");
  const empty = el("empty");
  if (header) header.style.display = "none";
  if (empty) {
    empty.style.display = "block";

    // Keep your existing empty-state layout (it has <p class="muted"> ...)
    const p = empty.querySelector("p.muted") || empty.querySelector("p");
    if (p && message) p.textContent = message;
  }
}

function loadSummary(attemptId) {
  // 1) New attempt key
  if (attemptId) {
    const raw = localStorage.getItem(getAttemptKey(attemptId));
    const parsed = safeJsonParse(raw);
    if (parsed) return parsed;
  }

  // 2) fallback legacy keys
  for (const k of FALLBACK_KEYS) {
    const parsed = safeJsonParse(localStorage.getItem(k));
    if (parsed) return parsed;
  }

  return null;
}

function renderAttempt(summary, attemptIdFromUrl) {
  const qsEl = el("qs");
  const titleEl = el("title");
  const metaEl = el("meta");
  const pillEl = el("scorePill");
  const header = el("headerCard");
  const empty = el("empty");
  const chipsEl = el("chips");
  const actionsEl = el("actions");
  const backToQuiz = el("backToQuiz");

  if (!qsEl || !titleEl || !metaEl || !pillEl || !header) {
    console.error("reviewpage.js: review.html is missing required IDs");
    return;
  }

  const items = Array.isArray(summary?.items) ? summary.items : [];
  if (items.length === 0) {
    showEmpty("No attempt found. Finish a quiz first, then you'll land here with a breakdown.");
    return;
  }

  // Ensure correct visibility
  header.style.display = "block";
  if (empty) empty.style.display = "none";

  // Totals
  const totals = summary.totals || {};
  const total = Number.isFinite(totals.total) ? totals.total : items.length;
  const answered = Number.isFinite(totals.answered)
    ? totals.answered
    : items.filter((i) => i.chosenIndex != null).length;

  const correct = Number.isFinite(totals.correct)
    ? totals.correct
    : items.reduce((n, it) => {
        const ci = Number.isFinite(it.correctIndex) ? it.correctIndex : null;
        const ui = Number.isFinite(it.chosenIndex) ? it.chosenIndex : null;
        return n + (ui != null && ci != null && ui === ci ? 1 : 0);
      }, 0);

  const scorePct = Number.isFinite(totals.scorePercent)
    ? totals.scorePercent
    : (total ? Math.round((correct / total) * 100) : 0);

  const finishedAt = summary.generatedAt || new Date().toISOString();
  const finishedLabel = new Date(finishedAt).toLocaleString();
  const timeLabel = formatDuration(
    Number.isFinite(totals.timeSpentSec) ? totals.timeSpentSec : 0
  );

  // Title
  const titleText = summary.title || summary.sectionTitle || "Review";
  document.title = titleText;
  titleEl.textContent = titleText;

  metaEl.textContent =
    `Answered ${answered}/${total} • Correct ${correct} • ` +
    `Time ${timeLabel} • Completed ${finishedLabel}`;

  pillEl.innerHTML = `<span>${scorePct}%</span><span class="small">Score</span>`;

  // Chips + back-to-quiz link (preserve quizId if available)
  if (chipsEl) {
    chipsEl.innerHTML = "";
    const quizId = summary.quizId || summary.sectionId || "";
    const attemptId = summary.attemptId || attemptIdFromUrl || "";

    if (quizId) chipsEl.insertAdjacentHTML("beforeend", `<span class="chip">quizId: ${quizId}</span>`);
    if (attemptId) chipsEl.insertAdjacentHTML("beforeend", `<span class="chip">attemptId: ${attemptId}</span>`);
  }

  if (actionsEl && backToQuiz) {
    const quizId = summary.quizId || "";
    if (quizId) {
      actionsEl.style.display = "flex";
      backToQuiz.href = `/pages/quiz.html?quizId=${encodeURIComponent(quizId)}`;
    } else {
      actionsEl.style.display = "none";
    }
  }

  // Render question cards
  qsEl.innerHTML = "";

  items.forEach((it, idx) => {
    const number = it.number ?? (idx + 1);
    const choices = Array.isArray(it.choices) ? it.choices : [];

    const correctIndex = Number.isFinite(it.correctIndex) ? it.correctIndex : null;
    const chosenIndex = Number.isFinite(it.chosenIndex) ? it.chosenIndex : null;

    const unanswered = chosenIndex == null;
    const isCorrect = !unanswered && correctIndex != null && chosenIndex === correctIndex;

    const sec = document.createElement("section");
    sec.className = "q " + (isCorrect ? "ok" : "no");

    const resultLabel = isCorrect ? "Correct" : (unanswered ? "Not answered" : "Incorrect");
    const metaBits = [];

    // Bring over your “IDs for Step 4” style meta if present
    const qid = it.questionId || it.id || "";
    const ver = it.version || "";
    if (qid) metaBits.push(`questionId: ${qid}${ver ? ` (v${ver})` : ""}`);
    if (Number.isFinite(it.timeSpentSec)) metaBits.push(`time: ${it.timeSpentSec}s`);
    if (Number.isFinite(it.visits)) metaBits.push(`visits: ${it.visits}`);

    const choiceHtml = choices.map((c, i) => {
      const isAns = correctIndex === i;
      const isUser = chosenIndex === i;

      const tags = [];
      if (isUser && isAns) {
        tags.push('<span class="tag you">Your choice</span>');
        tags.push('<span class="tag correct">Correct</span>');
      } else if (isUser && !isAns) {
        tags.push('<span class="tag you">Your choice</span>');
        tags.push('<span class="tag wrong">Wrong</span>');
      } else if (!isUser && isAns) {
        tags.push('<span class="tag correct">Correct</span>');
      }

      // If unanswered, still show which was correct
      if (unanswered && isAns && tags.length === 1) {
        tags.push('<span class="tag unanswered">You left blank</span>');
      }

      const cls = ["choice", isAns ? "correct" : "", isUser ? "your" : ""].join(" ").trim();

      return `
        <div class="${cls}">
          <div><b>${letter(i)}.</b> ${c}</div>
          <div class="tags">${tags.join(" ")}</div>
        </div>
      `;
    }).join("");

    // Solution block (your richer one)
    const correctLetter = correctIndex != null ? letter(correctIndex) : "—";
    const correctText = correctIndex != null && choices[correctIndex] != null ? choices[correctIndex] : "";

    const yourLetter = chosenIndex != null ? letter(chosenIndex) : "—";
    const yourText = chosenIndex != null && choices[chosenIndex] != null ? choices[chosenIndex] : "";

    const skill = it.skill || it.skillLabel || "";
    const difficulty = it.difficulty || "";
    const reasoning = it.explanation || "";
    const steps = Array.isArray(it.steps) ? it.steps : [];
    
    // Extract full solution object data
    const solution = it.solution || {};
    const commonMistakes = Array.isArray(solution.commonMistakes) ? solution.commonMistakes : [];
    const checks = Array.isArray(solution.checks) ? solution.checks : [];

    let solutionHtml = `<ul>`;
    solutionHtml += `<li><b>Correct answer:</b> ${correctLetter}. ${correctText}</li>`;
    solutionHtml += unanswered
      ? `<li><b>Your answer:</b> (no answer selected)</li>`
      : `<li><b>Your answer:</b> ${yourLetter}. ${yourText} ${isCorrect ? "(correct)" : "(incorrect)"}.</li>`;
    if (skill) solutionHtml += `<li><b>What this tested:</b> ${skill}${difficulty ? " — " + difficulty : ""}</li>`;
    else if (difficulty) solutionHtml += `<li><b>Difficulty:</b> ${difficulty}</li>`;
    if (reasoning) solutionHtml += `<li><b>Reasoning:</b> ${reasoning}</li>`;
    if (steps.length) {
      solutionHtml += `<li><b>Step-by-step:</b><ul>${steps.map((s) => `<li>${s}</li>`).join("")}</ul></li>`;
    }
    if (commonMistakes.length) {
      solutionHtml += `<li><b>Common mistakes to avoid:</b><ul>${commonMistakes.map((m) => `<li>${m}</li>`).join("")}</ul></li>`;
    }
    if (checks.length) {
      solutionHtml += `<li><b>How to check your answer:</b><ul>${checks.map((c) => `<li>${c}</li>`).join("")}</ul></li>`;
    }
    solutionHtml += `</ul>`;

    sec.innerHTML = `
      <div class="qhead">
        <div class="badge ${isCorrect ? "ok" : "no"}">${number}</div>
        <div>
          <div class="prompt">${it.prompt || ""}</div>
          ${metaBits.length ? `<div class="submeta">${metaBits.map((x, idx2) => `${idx2 ? '<span class="dot">•</span>' : ""}<span>${x}</span>`).join(" ")}</div>` : ""}
        </div>
      </div>

      <div class="choices">${choiceHtml}</div>

      <div class="solution">
        <b>Solution:</b>
        ${solutionHtml}
        ${unanswered ? `<div class="tags" style="margin-top:8px"><span class="tag unanswered">You left this blank</span></div>` : ""}
      </div>
    `;

    // Optional: include a tiny result label if you want it visible (kept minimal)
    // You can delete this block if you don't want the text label.
    const head = sec.querySelector(".qhead");
    if (head) {
      head.insertAdjacentHTML(
        "beforeend",
        `<div class="submeta" style="margin-left:auto">${resultLabel}</div>`
      );
    }

    qsEl.appendChild(sec);
  });

  // If MathJax is present, typeset (best-of summary-view.js)
  if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
    window.MathJax.typesetPromise([qsEl]).catch(() => {});
  }
}

(function init() {
  let attemptId = getParam("attemptId");

  if (!attemptId) {
    // If user came here without an ID, pick most recent attempt for better UX
    attemptId = findLatestAttemptId();
    if (attemptId) {
      const u = new URL(location.href);
      u.searchParams.set("attemptId", attemptId);
      history.replaceState(null, "", u.toString());
    }
  }

  const summary = loadSummary(attemptId);

  if (!summary) {
    showEmpty("No attempt found. Finish a quiz first.");
    return;
  }

  // If we loaded from fallback keys, attemptId might be null—pass URL attemptId anyway
  renderAttempt(summary, attemptId);
})();
