// /assets/js/pages/reviewpage.js

function getParam(name) {
  const params = new URLSearchParams(location.search);
  return params.get(name);
}

function safeJsonParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getAttemptKey(attemptId) {
  return `dsa:attempt:${attemptId}`;
}

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

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
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
    const p = empty.querySelector("p");
    if (p && message) p.textContent = message;
  }
}

function renderAttempt(summary) {
  const qsEl = el("qs");
  const titleEl = el("title");
  const metaEl = el("meta");
  const pillEl = el("scorePill");

  if (!qsEl || !titleEl || !metaEl || !pillEl) {
    console.error("reviewpage.js: review.html is missing required IDs");
    return;
  }

  const items = Array.isArray(summary?.items) ? summary.items : [];
  if (items.length === 0) {
    showEmpty("No summary found. Take a quiz first, then you'll land here with a breakdown.");
    return;
  }

  const totals = summary.totals || {};
  const answered = Number.isFinite(totals.answered) ? totals.answered : items.filter(i => i.chosenIndex != null).length;
  const correct = Number.isFinite(totals.correct) ? totals.correct : items.filter(i => i.correct).length;
  const total = Number.isFinite(totals.total) ? totals.total : items.length;
  const scorePct = Number.isFinite(totals.scorePercent)
    ? totals.scorePercent
    : (total ? Math.round((correct / total) * 100) : 0);

  const finishedAt = summary.generatedAt || new Date().toISOString();
  const finishedLabel = new Date(finishedAt).toLocaleString();
  const timeLabel = fmtTime(totals.timeSpentSec);

  titleEl.textContent = summary.title || "Review";
  metaEl.textContent = `Answered ${answered}/${total} • Correct ${correct} • Time ${timeLabel} • Completed ${finishedLabel}`;
  pillEl.innerHTML = `<span>${scorePct}%</span><span class="small">Score</span>`;

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

    const choiceHtml = choices.map((c, i) => {
      const isAns = correctIndex === i;
      const isUser = chosenIndex === i;

      const tags = [];
      if (isUser) tags.push('<span class="tag you">Your choice</span>');
      if (isAns) tags.push('<span class="tag correct">Correct answer</span>');
      if (!isAns && isUser && !isCorrect) tags.push('<span class="tag wrong">Marked wrong</span>');

      const cls = ["choice", isAns ? "correct" : "", isUser ? "your" : ""].join(" ").trim();

      return `
        <div class="${cls}">
          <div><b>${letter(i)}.</b> ${c}</div>
          <div class="tags">${tags.join(" ")}</div>
        </div>
      `;
    }).join("");

    const correctLetter = correctIndex != null ? letter(correctIndex) : "—";
    const correctText = correctIndex != null && choices[correctIndex] != null ? choices[correctIndex] : "";
    const yourLetter = chosenIndex != null ? letter(chosenIndex) : "—";
    const yourText = chosenIndex != null && choices[chosenIndex] != null ? choices[chosenIndex] : "";

    const skill = it.skill || it.skillLabel || "";
    const difficulty = it.difficulty || "";
    const reasoning = it.explanation || "";
    const steps = Array.isArray(it.steps) ? it.steps : [];

    let solutionHtml = `<ul>`;
    solutionHtml += `<li><b>Correct answer:</b> ${correctLetter}. ${correctText}</li>`;
    solutionHtml += unanswered
      ? `<li><b>Your answer:</b> (no answer selected)</li>`
      : `<li><b>Your answer:</b> ${yourLetter}. ${yourText} ${isCorrect ? "(matches)" : "(does not match)"}.</li>`;
    if (skill) solutionHtml += `<li><b>What this tests:</b> ${skill}${difficulty ? " — " + difficulty : ""}</li>`;
    else if (difficulty) solutionHtml += `<li><b>Difficulty:</b> ${difficulty}</li>`;
    if (reasoning) solutionHtml += `<li><b>Reasoning:</b> ${reasoning}</li>`;
    if (steps.length) {
      solutionHtml += `<li><b>Step-by-step:</b><ul>${steps.map(s => `<li>${s}</li>`).join("")}</ul></li>`;
    }
    solutionHtml += `</ul>`;

    const unansweredTag = unanswered ? `<span class="tag unanswered">You left this blank</span>` : "";

    sec.innerHTML = `
      <div class="qhead">
        <div class="badge ${isCorrect ? "ok" : "no"}">${number}</div>
        <div class="prompt">${it.prompt || ""}</div>
      </div>
      <div class="choices">${choiceHtml}</div>
      <div class="exp">
        <b>Solution:</b>
        ${solutionHtml}
        ${unansweredTag}
      </div>
    `;

    qsEl.appendChild(sec);
  });
}

(function init() {
  let attemptId = getParam("attemptId");

  if (!attemptId) {
    attemptId = findLatestAttemptId();
    if (attemptId) {
      // Keep URL stable for reload/share
      const u = new URL(location.href);
      u.searchParams.set("attemptId", attemptId);
      history.replaceState(null, "", u.toString());
    }
  }

  if (!attemptId) {
    showEmpty("No attempt found. Finish a quiz first.");
    return;
  }

  const raw = localStorage.getItem(getAttemptKey(attemptId));
  const summary = safeJsonParse(raw);

  if (!summary) {
    showEmpty("Attempt not found (it may have been cleared). Finish a quiz again to generate a new review.");
    return;
  }

  renderAttempt(summary);
})();
