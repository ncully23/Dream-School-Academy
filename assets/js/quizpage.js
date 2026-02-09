// /assets/js/pages/quizpage.js
// Dream School Academy — quiz loader (normal quizId + random mode)
//
// Supports:
// 1) Normal mode: /pages/quiz.html?quizId=...  (or window.DSA_BOOT)
// 2) Random mode: /pages/quiz.html?mode=random&section=math&count=10&difficulty=hard&untimed=1
//
// Random mode loads /assets/questionbank/math/banks.math.json and samples from all listed banks.
// IMPORTANT: Random mode is resilient to missing banks (404). Missing banks are skipped.
//
// NEW (critical for Progress logging):
// - Ensures every run has a unique runId + storageKey, so attempts don't collide.
// - Signals quiz-engine with config fields commonly used to save attempts:
//   attemptId, attemptKey, attemptScope, bankId/bankVersion (when available), mode.
// - Keeps normal quizzes stable but fixes random quiz overwriting issues that prevent logging.

"use strict";

/* -----------------------------
   Fetch helpers
------------------------------ */

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

/* -----------------------------
   URL helpers
------------------------------ */

function getParams() {
  return new URLSearchParams(location.search);
}

function getQuizIdFromUrl() {
  return getParams().get("quizId");
}

function isRandomMode(params) {
  return params.get("mode") === "random";
}

function getRandomSettings(params) {
  const section = (params.get("section") || "math").toLowerCase();
  const countRaw = Number(params.get("count") || 10);
  const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(50, countRaw)) : 10;

  const difficulty = (params.get("difficulty") || "").toLowerCase().trim();
  const untimed = params.get("untimed") === "1";
  return { section, count, difficulty, untimed };
}

/* -----------------------------
   Minimal UI error (so you don't get "silent Loading...")
------------------------------ */

function renderFatal(message) {
  console.error(message);

  const titleEl = document.getElementById("sectionTitle");
  if (titleEl) titleEl.textContent = "Quiz failed to load";

  const timeEl = document.getElementById("timeLeft");
  if (timeEl) timeEl.textContent = "--:--";

  const qTitle = document.getElementById("qtitle");
  if (qTitle) qTitle.textContent = "Quiz failed to load";

  const choices = document.getElementById("choices");
  if (choices) {
    choices.innerHTML = `
      <div class="load-error" style="padding:12px 14px;border:1px solid rgba(220,38,38,.35);border-radius:12px;">
        <div style="font-weight:800;margin-bottom:6px;">Couldn’t start this quiz.</div>
        <div style="opacity:.9;line-height:1.35">${String(message)}</div>
        <div style="opacity:.7;margin-top:10px;font-size:.9rem">
          Open DevTools → Console for details.
        </div>
      </div>
    `;
  }
}

/* -----------------------------
   IDs + timestamps
------------------------------ */

function nowISODate() {
  // YYYY-MM-DD (local)
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeAttemptId() {
  // Prefer crypto UUID; fall back safely
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return `att_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/* -----------------------------
   Question utilities
------------------------------ */

function asArray(x) {
  return Array.isArray(x) ? x : (x ? [x] : []);
}

function normalizeQuestion(q) {
  // Banks currently use answerIndex; engine expects correctIndex.
  const correctIndex =
    Number.isFinite(q?.correctIndex) ? q.correctIndex :
    Number.isFinite(q?.answerIndex) ? q.answerIndex :
    null;

  // Ensure stable IDs if absent (helps review/progress)
  const questionId = q?.questionId || q?.id || null;

  return { ...q, correctIndex, questionId };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function sampleUnique(pool, n) {
  const copy = pool.slice();
  shuffleInPlace(copy);
  return copy.slice(0, n);
}

/* -----------------------------
   Normal mode: pick questions from a single bank
------------------------------ */

function pickQuestionsFromBank(bank, cfg) {
  if (!bank || !Array.isArray(bank.questions)) return [];
  const n = Number(cfg.pickCount || cfg.pick || cfg.count || bank.questions.length);

  // Respect shuffle if you later set it true in quizzes.json
  const qs = bank.questions.slice().map(normalizeQuestion);
  if (cfg.shuffle) shuffleInPlace(qs);

  return qs.slice(0, n);
}

/* -----------------------------
   Random mode: load registry + banks (tolerant of 404)
------------------------------ */

async function loadRegistryBanks(registryUrl) {
  const reg = await loadJson(registryUrl);
  const urls = asArray(reg?.banks);

  if (!urls.length) {
    throw new Error(`Bank registry had no banks: ${registryUrl}`);
  }

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const payload = await loadJson(url);
      payload.__bankUrl = url;
      return payload;
    })
  );

  const ok = [];
  const failed = [];

  for (const r of results) {
    if (r.status === "fulfilled") ok.push(r.value);
    else failed.push(r.reason);
  }

  if (failed.length) {
    console.warn("[Random mode] Some banks failed to load and were skipped:");
    for (const err of failed) console.warn(err);
  }

  if (!ok.length) {
    throw new Error(
      `All banks in ${registryUrl} failed to load. ` +
      `Fix the URLs in banks.math.json or create the missing files.`
    );
  }

  return ok;
}

function flattenQuestions(bankPayloads) {
  const all = [];
  for (const b of bankPayloads) {
    const qs = asArray(b?.questions);
    for (const q of qs) {
      // Carry bank metadata so attempts can store it (useful for review/progress)
      const nq = normalizeQuestion(q);
      nq.__sourceBankId = b?.bankId || b?.topic || null;
      nq.__sourceBankVersion = b?.bankVersion ?? b?.version ?? null;
      nq.__sourceBankTitle = b?.title || null;
      nq.__sourceBankUrl = b?.__bankUrl || null;
      all.push(nq);
    }
  }
  return all;
}

function filterQuestionsForRandom(pool, settings) {
  let out = pool;

  // Section gate (expects topics like "math.circles")
  if (settings.section === "math") {
    out = out.filter(q => String(q?.topic || "").startsWith("math."));
  }

  if (settings.difficulty) {
    out = out.filter(q => String(q?.difficulty || "").toLowerCase() === settings.difficulty);
  }

  // Must be runnable
  out = out.filter(q =>
    typeof q?.prompt === "string" &&
    Array.isArray(q?.choices) &&
    q.choices.length >= 2 &&
    Number.isFinite(q?.correctIndex)
  );

  return out;
}

/* -----------------------------
   Build engine config
------------------------------ */

function setEngineConfig({
  quizId,
  title,
  sectionTitle,
  timeLimitSec,
  questions,

  // New: attempt identity + better metadata for saving
  mode,
  attemptId,
  bankId,
  bankVersion,
  description,
}) {
  // Unique per run => prevents overwriting drafts/attempts (especially for random)
  const runQuizKey = attemptId ? `${quizId}:${attemptId}` : quizId;
  const storageKey = `dsa:draft:${runQuizKey}`;

  window.dsaQuizConfig = {
    quizId,
    sectionId: quizId,
    title: title || "Quiz",
    description: description || "",
    sectionTitle: sectionTitle || title || "Quiz",

    // Untimed should be 0 or null depending on how your engine checks it.
    // If engine does: if (timeLimitSec) startTimer(); then 0 disables timer.
    timeLimitSec: Number.isFinite(timeLimitSec) ? timeLimitSec : null,

    // Draft key (unique per run for random; stable for normal if engine ignores attemptId)
    storageKey,

    // Provide attempt identity for quiz-engine/review/progress pipelines
    attemptId: attemptId || null,
    attemptKey: attemptId ? `dsa:attempt:${attemptId}` : null,
    mode: mode || "normal",

    // Bank metadata (helps review loader and progress rendering)
    bankId: bankId || null,
    bankVersion: Number.isFinite(bankVersion) ? bankVersion : null,

    pauseOnBlur: false,
    allowDraftSave: false,

    // Normalize questions already
    questions,
  };

  document.title = window.dsaQuizConfig.sectionTitle;
}

/* -----------------------------
   Init
------------------------------ */

(async function initQuiz() {
  const params = getParams();
  const boot = window.DSA_BOOT || null;

  // RANDOM MODE overrides boot/quizId
  if (isRandomMode(params)) {
    const settings = getRandomSettings(params);

    if (settings.section !== "math") {
      renderFatal(`Random mode currently supports section=math only (got: ${settings.section}).`);
      return;
    }

    const registryUrl = "/assets/questionbank/math/banks.math.json";

    let bankPayloads;
    try {
      bankPayloads = await loadRegistryBanks(registryUrl);
    } catch (err) {
      renderFatal(err?.message || err);
      return;
    }

    const poolAll = flattenQuestions(bankPayloads);
    const pool = filterQuestionsForRandom(poolAll, settings);

    if (pool.length < settings.count) {
      renderFatal(
        `Not enough questions available for random practice. ` +
        `Need ${settings.count}, found ${pool.length}. ` +
        (settings.difficulty ? `difficulty=${settings.difficulty}. ` : `difficulty=any. `) +
        `Add more bank files and/or update ${registryUrl}.`
      );
      return;
    }

    const sampled = sampleUnique(pool, settings.count);

    // Unique attempt per random run (prevents collisions + enables progress logging)
    const attemptId = makeAttemptId();

    const quizId = "random.math";
    const title = "Random Math Practice";
    const sectionTitle = settings.untimed ? "Untimed · Random Math" : "Random Math";

    // Untimed: 0 disables timer in most implementations
    const timeLimitSec = settings.untimed ? 0 : null;

    // For random: bankId/bankVersion are "mixed" — store registry scope
    const bankId = "math.random";
    const bankVersion = 1;

    const description =
      `Randomized practice across all Math banks. ` +
      `count=${settings.count}` +
      (settings.difficulty ? `, difficulty=${settings.difficulty}` : ``) +
      (settings.untimed ? `, untimed` : ``) +
      `. updatedAt=${nowISODate()}.`;

    setEngineConfig({
      quizId,
      title,
      sectionTitle,
      timeLimitSec,
      questions: sampled,
      mode: "random",
      attemptId,
      bankId,
      bankVersion,
      description,
    });

    await import("/assets/js/quiz-engine.js");
    return;
  }

  // NORMAL MODE
  const quizId = boot?.quizId || getQuizIdFromUrl();
  if (!quizId) {
    renderFatal("Missing quizId. Use /pages/quiz.html?quizId=math.circles");
    return;
  }

  const cfg = boot?.cfg || null;
  const bankUrl = boot?.bankUrl || cfg?.bank;
  if (!cfg || !bankUrl) {
    renderFatal("Missing cfg/bankUrl (expected window.DSA_BOOT = { quizId, cfg, bankUrl }).");
    return;
  }

  let bank;
  try {
    bank = await loadJson(bankUrl);
  } catch (err) {
    renderFatal(err?.message || err);
    return;
  }

  const questions = pickQuestionsFromBank(bank, cfg);
  if (!questions.length) {
    renderFatal(`Bank loaded but contained no questions: ${bankUrl}`);
    return;
  }

  // For normal quizzes, still generate attemptId so each run can log uniquely.
  // If your engine already generates its own attemptId, it can ignore this.
  const attemptId = makeAttemptId();

  setEngineConfig({
    quizId,
    title: cfg.title || bank.title || "Quiz",
    sectionTitle: cfg.sectionTitle || cfg.title || bank.title || "Quiz",
    timeLimitSec: cfg.timeLimitSec ?? null,
    questions,

    mode: "normal",
    attemptId,

    bankId: bank?.bankId || bank?.topic || quizId,
    bankVersion: bank?.bankVersion ?? bank?.version ?? null,
    description: bank?.description || "",
  });

  await import("/assets/js/quiz-engine.js");
})().catch((err) => renderFatal(err?.message || err));
