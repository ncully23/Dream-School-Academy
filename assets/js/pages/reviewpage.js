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

"use strict";

import { auth, db, authReady } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

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
    const t =
      Date.parse(parsed?.generatedAt || "") ||
      Date.parse(parsed?.createdAt || "") ||
      0;

    if (t > bestTime) {
      bestTime = t;
      bestId = k.replace("dsa:attempt:", "");
    }
  }

  return bestId;
}

function loadAttemptFromLocal(attemptId) {
  if (!attemptId) return null;
  return safeJsonParse(localStorage.getItem(getAttemptKey(attemptId)));
}

async function loadAttemptFromFirestore(attemptId) {
  if (!attemptId) return null;

  // Ensure auth state is settled
  await authReady;

  const user = auth.currentUser;
  if (!user) return null;

  const ref = doc(db, "users", user.uid, "attempts", attemptId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data() || {};
  return normalizeAttemptShapeFromFirestore(data);
}

/* -----------------------------
   Shape normalization
------------------------------ */

function asArray(x) {
  return Array.isArray(x) ? x : (x ? [x] : []);
}

function normalizeAttemptShapeFromFirestore(data) {
  // Firestore attempt schema can vary; normalize to the renderer's expected "summary" shape.
  // Expected by renderer:
  // {
  //   quizId, title, sectionTitle, generatedAt,
  //   totals: { total, answered, correct, scorePercent, timeSpentSec },
  //   items: [{ number, prompt, choices, chosenIndex, correctIndex, skill, difficulty, solution: {...} }]
  // }

  const itemsRaw = asArray(data.items || data.questions || data.responses);

  const items = itemsRaw.map((it, idx) => {
    const correctIndex =
      Number.isFinite(it.correctIndex) ? it.correctIndex :
      Number.isFinite(it.answerIndex) ? it.answerIndex :
      Number.isFinite(it.correct) ? it.correct :
      null;

    const chosenIndex =
      Number.isFinite(it.chosenIndex) ? it.chosenIndex :
      Number.isFinite(it.selectedIndex) ? it.selectedIndex :
      Number.isFinite(it.userIndex) ? it.userIndex :
      null;

    return {
      number: it.number ?? (idx + 1),
      questionId: it.questionId || it.id || null,
      topic: it.topic || null,
      skill: it.skill || null,
      difficulty: it.difficulty || null,
      prompt: it.prompt || it.stem || "",
      choices: asArray(it.choices || it.options),
      chosenIndex,
      correctIndex,
      timeSpentSec: Number.isFinite(it.timeSpentSec) ? it.timeSpentSec : null,
      solution: typeof it.solution === "object" ? it.solution : (typeof it.explanation === "object" ? it.explanation : {}),
    };
  });

  const total = Number.isFinite(data.total) ? data.total : items.length;
  const correct =
    Number.isFinite(data.correct) ? data.correct :
    items.reduce((n, it) => {
      const ui = Number.isFinite(it.chosenIndex) ? it.chosenIndex : null;
      const ci = Number.isFinite(it.correctIndex) ? it.correctIndex : null;
      return n + (ui != null && ci != null && ui === ci ? 1 : 0);
    }, 0);

  const answered =
    Number.isFinite(data.answered) ? data.answered :
    items.filter(i => i.chosenIndex != null).length;

  const timeSpentSec =
    Number.isFinite(data.timeSpentSec) ? data.timeSpentSec :
    (Number.isFinite(data.durationSec) ? data.durationSec :
      (Number.isFinite(data.durationMs) ? Math.round(data.durationMs / 1000) : 0));

  const scorePercent =
    Number.isFinite(data.scorePercent) ? data.scorePercent :
    (Number.isFinite(data.pct) ? Math.round(Number(data.pct) * 100) :
      (total ? Math.round((correct / total) * 100) : 0));

  // createdAt may be Firestore Timestamp; handle both
  const createdAtISO =
    typeof data.createdAt?.toDate === "function"
      ? data.createdAt.toDate().toISOString()
      : (typeof data.createdAt === "string" ? data.createdAt : null);

  const generatedAt =
    data.generatedAt ||
    createdAtISO ||
    (typeof data.updatedAt?.toDate === "function" ? data.updatedAt.toDate().toISOString() : null) ||
    new Date().toISOString();

  return {
    attemptId: data.attemptId || data.id || null,
    quizId: data.quizId || data.sectionId || "unknown",
    title: data.title || "Review",
    sectionTitle: data.sectionTitle || data.title || "Review",
    generatedAt,
    bankId: data.bankId || null,
    bankVersion: data.bankVersion ?? null,
    totals: {
      total,
      answered,
      correct,
      scorePercent,
      timeSpentSec,
    },
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
  const sol = typeof it?.solution === "object" ? it.solution : {};
  return {
    finalAnswer: sol.finalAnswer ?? null,
    approach: sol.approach ?? null,
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

  const total = summary.totals?.total ?? items.length;

  const answered =
    summary.totals?.answered ??
    items.filter(i => i.chosenIndex != null).length;

  const correct =
    summary.totals?.correct ??
    items.reduce((n, it) => {
      const ui = Number.isFinite(it.chosenIndex) ? it.chosenIndex : null;
      const ci = Number.isFinite(it.correctIndex) ? it.correctIndex : null;
      return n + (ui != null && ci != null && ui === ci ? 1 : 0);
    }, 0);

  const scorePct =
    summary.totals?.scorePercent ??
    (total ? Math.round((correct / total) * 100) : 0);

  const finishedAt = summary.generatedAt || new Date().toISOString();
  const timeLabel = formatDuration(summary.totals?.timeSpentSec || 0);

  const titleText = summary.title || summary.sectionTitle || "Review";
  document.title = titleText;
  titleEl.textContent = titleText;

  metaEl.textContent =
    `Answered ${answered}/${total} • Correct ${correct} • ` +
    `Time ${timeLabel} • Completed ${new Date(finishedAt).toLocaleString()}`;

  pillEl.innerHTML = `<span>${scorePct}%</span><span class="small">Score</span>`;

  if (chipsEl) {
    chipsEl.innerHTML = "";
    if (summary.quizId) chipsEl.appendChild(el("span", "review-chip", `quizId: ${summary.quizId}`));
    if (attemptIdFromUrl) chipsEl.appendChild(el("span", "review-chip", `attemptId: ${attemptIdFromUrl}`));
    if (summary.bankId) chipsEl.appendChild(el("span", "review-chip", `bankId: ${summary.bankId}`));
    if (summary.bankVersion != null) chipsEl.appendChild(el("span", "review-chip", `bankVersion: ${summary.bankVersion}`));
  }

  if (actionsEl && backToQuiz && summary.quizId) {
    actionsEl.style.display = "flex";
    // If random, send user back to random mode (best-effort)
    if (String(summary.quizId).startsWith("random.")) {
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
    if (Number.isFinite(it.timeSpentSec)) submeta.appendChild(el("span", "review-tag time", `time: ${Math.max(0, Math.floor(it.timeSpentSec))}s`));
    if (it.skill) submeta.appendChild(el("span", "review-tag skill", `skill: ${it.skill}`));
    if (it.difficulty) submeta.appendChild(el("span", "review-tag diff", `difficulty: ${it.difficulty}`));
    if (submeta.childNodes.length) headRight.appendChild(submeta);

    head.appendChild(badge);
    head.appendChild(headRight);

    const choicesWrap = el("div", "review-choices");
    choices.forEach((c, i) => {
      choicesWrap.appendChild(renderChoiceRow({
        choiceText: c,
        index: i,
        correctIndex: ci,
        chosenIndex: ui,
      }));
    });

    const exp = el("div", "review-exp");
    const expTitle = el("div", "", "");
    expTitle.appendChild(el("b", "", "Solution:"));
    exp.appendChild(expTitle);

    const ul = document.createElement("ul");

    if (ci != null) {
      const li = document.createElement("li");
      li.appendChild(el("b", "", "Correct answer: "));
      li.appendChild(document.createTextNode(`${letter(ci)}. ${choices[ci] ?? ""}`));
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
