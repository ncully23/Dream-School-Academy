// /assets/js/pages/reviewpage.js
// Canonical review renderer for Dream School Academy
//
// Goals:
// - supports ?attemptId=...
// - loads attempt from Firestore first (users/{uid}/attempts/{attemptId})
// - falls back to localStorage dsa:attempt:{attemptId}
// - if no attemptId, falls back to most recent localStorage dsa:attempt:*
// - renders rich solutions (approach, formulas, steps, mistakes, checks, takeaway)
// - correct/incorrect highlighting matches pages/review.html CSS
// - MathJax-safe if present
//
// Matches attempt-writer schema:
// attemptId, quizId, attemptType, title, createdAt/generatedAt,
// totals {answered, correct, total, timeSpentSec, scorePercent},
// items[] {questionId, version, choices, correctIndex, chosenIndex, correct, explanation},
// bank {bankId, bankVersion, title},
// pick {pickCount, seedMode, seedValue, picked:[{questionId, version}]}

"use strict";

import { auth, db, authReady } from "/assets/js/firebase-init.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

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

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("dsa:attempt:")) continue;

      const parsed = safeJsonParse(localStorage.getItem(k));
      const t =
        Date.parse(parsed?.generatedAt || "") ||
        Date.parse(parsed?.createdAt || "") ||
        0;

      if (t > bestTime) {
        bestTime = t;
        bestId = k.replace("dsa:attempt:", "");
      }
    }
  } catch {
    // ignore storage access issues
  }

  return bestId;
}

function loadAttemptFromLocal(attemptId) {
  if (!attemptId) return null;
  return safeJsonParse(localStorage.getItem(getAttemptKey(attemptId)));
}

async function loadAttemptFromFirestore(attemptId) {
  if (!attemptId) return null;

  await authReady;
  const user = auth.currentUser;
  if (!user) return null;

  const ref = doc(db, "users", user.uid, "attempts", attemptId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data() || {};
  // Ensure attemptId is present even if doc id is the id
  if (!data.attemptId) data.attemptId = attemptId;

  return normalizeAttemptShape(data);
}

/* -----------------------------
   Shape normalization
------------------------------ */

function asArray(x) {
  return Array.isArray(x) ? x : x ? [x] : [];
}

function toISO(ts) {
  if (!ts) return null;

  if (typeof ts === "string") {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (ts instanceof Date) return ts.toISOString();

  if (typeof ts?.toDate === "function") {
    try {
      const d = ts.toDate();
      return d instanceof Date ? d.toISOString() : null;
    } catch {
      return null;
    }
  }

  if (typeof ts === "number") {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}

function computeFromItems(items) {
  const total = items.length;
  const answered = items.filter((it) => Number.isFinite(it.chosenIndex)).length;
  const correct = items.filter((it) => it.correct === true).length;
  return { total, answered, correct };
}

function normalizeItem(it, idx) {
  const choices = asArray(it?.choices || it?.options);

  const correctIndex =
    Number.isFinite(it?.correctIndex) ? it.correctIndex :
    Number.isFinite(it?.answerIndex) ? it.answerIndex :
    null;

  const chosenIndex =
    Number.isFinite(it?.chosenIndex) ? it.chosenIndex :
    Number.isFinite(it?.selectedIndex) ? it.selectedIndex :
    Number.isFinite(it?.userIndex) ? it.userIndex :
    null;

  const correct =
    typeof it?.correct === "boolean"
      ? it.correct
      : (Number.isFinite(correctIndex) && Number.isFinite(chosenIndex) ? chosenIndex === correctIndex : false);

  // Explanation field in attempt-writer schema is typically a string
  // But we also tolerate {solution:{...}} objects from older banks
  let explanation = it?.explanation ?? it?.rationale ?? null;
  if (explanation && typeof explanation === "object") {
    explanation = explanation.text || explanation.body || null;
  }

  const solutionObj =
    typeof it?.solution === "object" && it.solution
      ? it.solution
      : (typeof it?.explanation === "object" && it.explanation ? it.explanation : null);

  return {
    number: it?.number ?? (idx + 1),
    questionId: it?.questionId || it?.id || null,
    version: Number.isFinite(it?.version) ? it.version : 1,
    topic: it?.topic || null,
    skill: it?.skill || null,
    difficulty: it?.difficulty || null,

    // Prefer the prompt if present; if not, render gracefully without it
    prompt: it?.prompt || it?.stem || "",

    choices,
    chosenIndex,
    correctIndex,
    correct,

    timeSpentSec: Number.isFinite(it?.timeSpentSec) ? it.timeSpentSec : null,

    // Keep both forms; renderer can use either
    explanation: typeof explanation === "string" ? explanation : null,
    solution: solutionObj || null,
  };
}

function normalizeAttemptShape(data) {
  const d = data || {};

  const rawItems = asArray(d.items || d.questions || d.responses);
  const items = rawItems.map(normalizeItem);

  const totalsIn = d.totals || {};
  const derived = computeFromItems(items);

  const total = Number.isFinite(totalsIn.total) ? totalsIn.total : (Number(d.total) || derived.total);
  const answered = Number.isFinite(totalsIn.answered) ? totalsIn.answered : (Number(d.answered) || derived.answered);
  const correct = Number.isFinite(totalsIn.correct) ? totalsIn.correct : (Number(d.correct) || derived.correct);

  const timeSpentSec =
    Number.isFinite(totalsIn.timeSpentSec) ? totalsIn.timeSpentSec :
    Number.isFinite(d.timeSpentSec) ? d.timeSpentSec :
    Number.isFinite(d.durationSec) ? d.durationSec :
    Number.isFinite(d.durationSeconds) ? d.durationSeconds :
    (Number.isFinite(d.durationMs) ? Math.round(d.durationMs / 1000) : 0);

  const scorePercent =
    Number.isFinite(totalsIn.scorePercent) ? totalsIn.scorePercent :
    Number.isFinite(d.scorePercent) ? d.scorePercent :
    (total > 0 ? Math.round((correct / total) * 1000) / 10 : 0);

  const generatedAt =
    d.generatedAt ||
    d.createdAt ||
    d.completedAt ||
    d.timestamp ||
    null;

  const generatedAtISO = toISO(generatedAt) || new Date().toISOString();

  const bankObj = d.bank || null;

  const bankId =
    bankObj?.bankId ||
    d.bankId ||
    d.topic ||
    d.quizId ||
    null;

  const bankVersion =
    (bankObj && Number.isFinite(bankObj.bankVersion)) ? bankObj.bankVersion :
    (Number.isFinite(d.bankVersion) ? d.bankVersion :
      (Number.isFinite(d.version) ? d.version : null));

  const bankTitle =
    bankObj?.title ||
    d.bankTitle ||
    d.title ||
    null;

  const attemptType =
    d.attemptType ||
    (d.mode === "random" ? "random" : null) ||
    (String(d.quizId || "").startsWith("random.") ? "random" : "topic");

  return {
    attemptId: d.attemptId || d.id || null,
    quizId: d.quizId || d.sectionId || "unknown",
    attemptType,
    title: d.title || d.sectionTitle || "Review",
    sectionTitle: d.sectionTitle || d.title || "Review",
    generatedAt: generatedAtISO,
    createdAt: toISO(d.createdAt) || null,

    totals: { total, answered, correct, scorePercent, timeSpentSec },

    bank: {
      bankId: bankId || null,
      bankVersion: Number.isFinite(bankVersion) ? bankVersion : null,
      title: bankTitle || null,
    },

    pick: typeof d.pick === "object" && d.pick ? d.pick : null,

    items,
  };
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

function normalizeSolution(it) {
  // Prefer structured solution object, otherwise use string explanation
  const sol = (typeof it?.solution === "object" && it.solution) ? it.solution : {};
  const explanation = (typeof it?.explanation === "string" && it.explanation) ? it.explanation : null;

  return {
    finalAnswer: sol.finalAnswer ?? null,
    approach: sol.approach ?? (explanation ? explanation : null),
    formulas: asArray(sol.formulas),
    steps: asArray(sol.steps),
    commonMistakes: asArray(sol.commonMistakes),
    checks: asArray(sol.checks),
    takeaway: sol.takeaway ?? null,
  };
}

/* -----------------------------
   Safe DOM helpers (avoid injection)
------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function appendTextWithMath(container, text) {
  // Keep it safe; MathJax can still typeset TeX in text nodes.
  container.textContent = String(text ?? "");
}

function showEmpty(message) {
  const header = $("headerCard");
  const empty = $("empty");
  if (header) header.style.display = "none";
  if (empty) {
    empty.style.display = "block";
    const p = empty.querySelector("p.review-muted") || empty.querySelector("p");
    if (p && message) p.textContent = message;
  }
}

function safeLocaleString(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

/* -----------------------------
   Render helpers
------------------------------ */

function renderChoiceRow({ choiceText, index, correctIndex, chosenIndex }) {
  const isCorrectChoice = (correctIndex != null && index === correctIndex);
  const isChosen = (chosenIndex != null && index === chosenIndex);
  const chosenIsCorrect = (isChosen && isCorrectChoice);

  // Class logic to match CSS in pages/review.html
  let cls = "review-choice";
  if (isCorrectChoice) cls += " correct";
  if (isChosen && !isCorrectChoice) cls += " your-wrong";
  if (chosenIsCorrect) cls += " your-correct";
  if (!isCorrectChoice && !isChosen) cls += " unselected";

  const row = el("div", cls);

  const left = el("div", "review-choice-left");
  const letterBox = el("div", "review-letter", `${letter(index)}`);
  const text = el("div", "review-choice-text");
  appendTextWithMath(text, choiceText);

  left.appendChild(letterBox);
  left.appendChild(text);

  const pills = el("div", "review-tags");

  if (isCorrectChoice) pills.appendChild(el("span", "review-pill correct", "Correct ✓"));

  if (isChosen && isCorrectChoice) {
    pills.appendChild(el("span", "review-pill your-correct", "Your answer ✓"));
  } else if (isChosen && !isCorrectChoice) {
    pills.appendChild(el("span", "review-pill your-wrong", "Your answer ✕"));
  }

  row.appendChild(left);
  row.appendChild(pills);
  return row;
}

function renderDeepExplanation(sol) {
  const hasAny =
    sol.approach ||
    sol.formulas.length ||
    sol.steps.length ||
    sol.commonMistakes.length ||
    sol.checks.length ||
    sol.takeaway;

  if (!hasAny) return null;

  const details = el("details", "review-deep");
  const summary = document.createElement("summary");
  summary.appendChild(el("span", "", "Deep explanation"));
  summary.appendChild(el("span", "review-chev"));
  details.appendChild(summary);

  if (sol.approach) {
    const p = document.createElement("p");
    p.appendChild(el("b", "", "Approach: "));
    p.appendChild(document.createTextNode(String(sol.approach)));
    details.appendChild(p);
  }

  if (sol.formulas.length) {
    details.appendChild(el("p", "", "Formulas:"));
    const ul = document.createElement("ul");
    sol.formulas.forEach((f) => {
      const li = document.createElement("li");
      appendTextWithMath(li, f);
      ul.appendChild(li);
    });
    details.appendChild(ul);
  }

  if (sol.steps.length) {
    details.appendChild(el("p", "", "Steps:"));
    const ol = document.createElement("ol");
    sol.steps.forEach((s) => {
      const li = document.createElement("li");
      appendTextWithMath(li, s);
      ol.appendChild(li);
    });
    details.appendChild(ol);
  }

  if (sol.commonMistakes.length) {
    details.appendChild(el("p", "", "Common mistakes:"));
    const ul = document.createElement("ul");
    sol.commonMistakes.forEach((m) => {
      const li = document.createElement("li");
      appendTextWithMath(li, m);
      ul.appendChild(li);
    });
    details.appendChild(ul);
  }

  if (sol.checks.length) {
    details.appendChild(el("p", "", "How to check:"));
    const ul = document.createElement("ul");
    sol.checks.forEach((c) => {
      const li = document.createElement("li");
      appendTextWithMath(li, c);
      ul.appendChild(li);
    });
    details.appendChild(ul);
  }

  if (sol.takeaway) {
    const p = document.createElement("p");
    p.appendChild(el("b", "", "Takeaway: "));
    p.appendChild(document.createTextNode(String(sol.takeaway)));
    details.appendChild(p);
  }

  return details;
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

  const totals = summary.totals || {};
  const total = Number.isFinite(totals.total) ? totals.total : items.length;
  const answered = Number.isFinite(totals.answered)
    ? totals.answered
    : items.filter((i) => Number.isFinite(i.chosenIndex)).length;
  const correct = Number.isFinite(totals.correct)
    ? totals.correct
    : items.filter((i) => i.correct === true).length;

  const scorePct = Number.isFinite(totals.scorePercent)
    ? totals.scorePercent
    : (total ? Math.round((correct / total) * 1000) / 10 : 0);

  const finishedAt = summary.generatedAt || summary.createdAt || new Date().toISOString();
  const timeLabel = formatDuration(Number(totals.timeSpentSec || 0));

  const titleText = summary.title || summary.sectionTitle || "Review";
  document.title = titleText;
  titleEl.textContent = titleText;

  const attemptTypeLabel =
    String(summary.attemptType || "").toLowerCase() === "random" ? "Random" : "Topic";

  metaEl.textContent =
    `Type ${attemptTypeLabel} • Answered ${answered}/${total} • Correct ${correct} • ` +
    `Time ${timeLabel} • Completed ${safeLocaleString(finishedAt)}`;

  pillEl.innerHTML = `<span>${Number(scorePct).toFixed(1)}%</span><span class="small">Score</span>`;

  if (chipsEl) {
    chipsEl.innerHTML = "";

    if (summary.quizId) chipsEl.appendChild(el("span", "review-chip", `quizId: ${summary.quizId}`));
    if (attemptIdFromUrl) chipsEl.appendChild(el("span", "review-chip", `attemptId: ${attemptIdFromUrl}`));

    const bank = summary.bank || {};
    if (bank.bankId) chipsEl.appendChild(el("span", "review-chip", `bankId: ${bank.bankId}`));
    if (bank.bankVersion != null) chipsEl.appendChild(el("span", "review-chip", `bankVersion: ${bank.bankVersion}`));
    if (bank.title) chipsEl.appendChild(el("span", "review-chip", `bank: ${bank.title}`));

    // Random pick diagnostics (optional)
    if (summary.pick && typeof summary.pick === "object") {
      const pc = summary.pick.pickCount;
      const sm = summary.pick.seedMode;
      const sv = summary.pick.seedValue;
      if (pc != null) chipsEl.appendChild(el("span", "review-chip", `pickCount: ${pc}`));
      if (sm) chipsEl.appendChild(el("span", "review-chip", `seedMode: ${sm}`));
      if (sv) chipsEl.appendChild(el("span", "review-chip", `seed: ${String(sv).slice(0, 12)}…`));
    }
  }

  if (actionsEl && backToQuiz && summary.quizId) {
    actionsEl.style.display = "flex";

    // Random attempts: return to random entrypoint
    if (String(summary.attemptType).toLowerCase() === "random" || String(summary.quizId).startsWith("random.")) {
      backToQuiz.href = `/pages/quiz.html?mode=random&section=math`;
    } else {
      backToQuiz.href = `/pages/quiz.html?quizId=${encodeURIComponent(summary.quizId)}`;
    }
  }

  qsEl.innerHTML = "";

  items.forEach((it, idx) => {
    const number = it.number ?? (idx + 1);
    const choices = asArray(it.choices);

    const ci = Number.isFinite(it.correctIndex) ? it.correctIndex : null;
    const ui = Number.isFinite(it.chosenIndex) ? it.chosenIndex : null;

    const unanswered = ui == null;
    const isCorrect = !unanswered && ci != null && ui === ci;

    const card = el("section", `review-q ${unanswered ? "na" : (isCorrect ? "ok" : "no")}`);

    const head = el("div", "review-qhead");
    const badge = el("div", `review-badge ${unanswered ? "na" : (isCorrect ? "ok" : "no")}`, String(number));

    const headRight = document.createElement("div");

    const prompt = el("div", "review-prompt");
    appendTextWithMath(prompt, it.prompt || "");
    headRight.appendChild(prompt);

    const submeta = el("div", "review-submeta");
    if (it.questionId) submeta.appendChild(el("span", "review-tag", `questionId: ${it.questionId}`));
    if (Number.isFinite(it.version)) submeta.appendChild(el("span", "review-tag", `v: ${it.version}`));
    if (Number.isFinite(it.timeSpentSec)) submeta.appendChild(el("span", "review-tag time", `time: ${Math.max(0, Math.floor(it.timeSpentSec))}s`));
    if (it.skill) submeta.appendChild(el("span", "review-tag skill", `skill: ${it.skill}`));
    if (it.difficulty) submeta.appendChild(el("span", "review-tag diff", `difficulty: ${it.difficulty}`));
    if (submeta.childNodes.length) headRight.appendChild(submeta);

    head.appendChild(badge);
    head.appendChild(headRight);

    const choicesWrap = el("div", "review-choices");
    choices.forEach((c, i) => {
      choicesWrap.appendChild(
        renderChoiceRow({
          choiceText: c,
          index: i,
          correctIndex: ci,
          chosenIndex: ui,
        })
      );
    });

    const exp = el("div", "review-exp");
    const expTitle = el("div", "", "");
    expTitle.appendChild(el("b", "", "Solution:"));
    exp.appendChild(expTitle);

    const ul = document.createElement("ul");

    if (ci != null) {
      const li = document.createElement("li");
      li.appendChild(el("b", "", "Correct answer: "));
      // Use MathJax-safe text nodes
      const txt = `${letter(ci)}. ${choices[ci] ?? ""}`;
      li.appendChild(document.createTextNode(txt));
      ul.appendChild(li);
    }

    {
      const li = document.createElement("li");
      li.appendChild(el("b", "", "Your answer: "));
      if (unanswered) {
        li.appendChild(document.createTextNode("(no answer selected)"));
      } else {
        const label = `${letter(ui)}. ${choices[ui] ?? ""}`;
        li.appendChild(document.createTextNode(label + (isCorrect ? " (correct)" : " (incorrect)")));
      }
      ul.appendChild(li);
    }

    if (it.skill) {
      const li = document.createElement("li");
      li.appendChild(el("b", "", "Skill: "));
      li.appendChild(document.createTextNode(String(it.skill)));
      ul.appendChild(li);
    }

    if (it.difficulty) {
      const li = document.createElement("li");
      li.appendChild(el("b", "", "Difficulty: "));
      li.appendChild(document.createTextNode(String(it.difficulty)));
      ul.appendChild(li);
    }

    exp.appendChild(ul);

    const sol = normalizeSolution(it);
    const deep = renderDeepExplanation(sol);
    if (deep) exp.appendChild(deep);

    card.appendChild(head);
    card.appendChild(choicesWrap);
    card.appendChild(exp);
    qsEl.appendChild(card);
  });

  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([qsEl]).catch(() => {});
  }
}

/* -----------------------------
   Init
------------------------------ */

(async function init() {
  let attemptId = getParam("attemptId");

  // If missing, try localStorage latest (cannot infer Firestore latest without a query)
  if (!attemptId) {
    attemptId = findLatestAttemptId();
    if (attemptId) {
      const u = new URL(location.href);
      u.searchParams.set("attemptId", attemptId);
      history.replaceState(null, "", u.toString());
    }
  }

  if (!attemptId) {
    showEmpty("No attempt found. Finish a quiz first.");
    return;
  }

  // 1) Firestore first (so Progress/review align)
  let summary = null;
  try {
    summary = await loadAttemptFromFirestore(attemptId);
  } catch (e) {
    console.warn("reviewpage: Firestore load failed; falling back to local.", e);
  }

  // 2) Fallback to local attempt
  if (!summary) {
    summary = loadAttemptFromLocal(attemptId);
    if (summary) summary = normalizeAttemptShape(summary);
  }

  if (!summary) {
    showEmpty("No attempt found. Finish a quiz first.");
    return;
  }

  renderAttempt(summary, attemptId);
})().catch((e) => {
  console.error("reviewpage init error:", e);
  showEmpty("Review failed to load. Open DevTools → Console for details.");
});
