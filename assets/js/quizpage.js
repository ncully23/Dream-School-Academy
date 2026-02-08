// /assets/js/pages/quizpage.js
// Dream School Academy — quiz loader (normal quizId + random mode)
//
// Supports:
// 1) Normal mode: /pages/quiz.html?quizId=...  (or window.DSA_BOOT)
// 2) Random mode: /pages/quiz.html?mode=random&section=math&count=10&difficulty=hard&untimed=1
//
// Random mode loads /assets/questionbank/math/banks.math.json and samples from all listed banks.

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
  const count = Math.max(1, Math.min(50, Number(params.get("count") || 10)));
  const difficulty = (params.get("difficulty") || "").toLowerCase().trim();
  const untimed = params.get("untimed") === "1";
  return { section, count, difficulty, untimed };
}

/* -----------------------------
   Question utilities
------------------------------ */

function asArray(x) {
  return Array.isArray(x) ? x : (x ? [x] : []);
}

function normalizeQuestion(q) {
  // Your banks currently use answerIndex.
  // Your attempt/review pipeline uses correctIndex.
  // Normalize here so the engine sees correctIndex consistently.
  const correctIndex =
    Number.isFinite(q?.correctIndex) ? q.correctIndex :
    Number.isFinite(q?.answerIndex) ? q.answerIndex :
    null;

  return {
    ...q,
    correctIndex,
  };
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
  return bank.questions.slice(0, n).map(normalizeQuestion);
}

/* -----------------------------
   Random mode: load registry + all banks
------------------------------ */

async function loadRegistryBanks(registryUrl) {
  const reg = await loadJson(registryUrl);
  const banks = asArray(reg?.banks);

  if (!banks.length) {
    throw new Error(`Bank registry had no banks: ${registryUrl}`);
  }

  const bankPayloads = await Promise.all(
    banks.map(async (url) => {
      const payload = await loadJson(url);
      payload.__bankUrl = url;
      return payload;
    })
  );

  return bankPayloads;
}

function flattenQuestions(bankPayloads) {
  const all = [];
  for (const b of bankPayloads) {
    const qs = asArray(b?.questions);
    for (const q of qs) {
      all.push(normalizeQuestion(q));
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

  // Difficulty filter (optional)
  if (settings.difficulty) {
    out = out.filter(q => String(q?.difficulty || "").toLowerCase() === settings.difficulty);
  }

  // Must have prompt + choices + correctIndex to be runnable
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
}) {
  window.dsaQuizConfig = {
    quizId,
    sectionId: quizId,
    title: title || "Quiz",
    sectionTitle: sectionTitle || title || "Quiz",

    // IMPORTANT: Your engine uses this to start timer; we set 0/null for untimed.
    timeLimitSec: Number.isFinite(timeLimitSec) ? timeLimitSec : null,

    storageKey: `dsa:draft:${quizId}`,

    pauseOnBlur: false,
    allowDraftSave: false,

    questions,
  };

  document.title = window.dsaQuizConfig.sectionTitle;
}

/* -----------------------------
   Init
------------------------------ */

(async function initQuiz() {
  const params = getParams();

  // 1) Prefer the boot payload from quiz.html (normal mode)
  const boot = window.DSA_BOOT || null;

  // RANDOM MODE overrides boot/quizId
  if (isRandomMode(params)) {
    const settings = getRandomSettings(params);

    if (settings.section !== "math") {
      throw new Error(`Random mode currently supports section=math only (got: ${settings.section})`);
    }

    // Load all math banks via registry
    const registryUrl = "/assets/questionbank/math/banks.math.json";
    const bankPayloads = await loadRegistryBanks(registryUrl);

    // Flatten + filter
    const poolAll = flattenQuestions(bankPayloads);
    const pool = filterQuestionsForRandom(poolAll, settings);

    if (pool.length < settings.count) {
      throw new Error(
        `Not enough questions available for random practice. ` +
        `Need ${settings.count}, found ${pool.length}. ` +
        (settings.difficulty ? `difficulty=${settings.difficulty}` : "difficulty=any")
      );
    }

    const sampled = sampleUnique(pool, settings.count);

    // Build a synthetic quiz config
    const quizId = "random.math";
    const title = "Random Math Practice";
    const sectionTitle = settings.untimed
      ? "Untimed · Random Math"
      : "Random Math";

    // Untimed: set to 0 (or null) so timer won’t start if your engine checks >0.
    const timeLimitSec = settings.untimed ? 0 : null;

    setEngineConfig({
      quizId,
      title,
      sectionTitle,
      timeLimitSec,
      questions: sampled,
    });

    // Load engine
    await import("/assets/js/quiz-engine.js");
    return;
  }

  // NORMAL MODE (existing behavior)
  const quizId = boot?.quizId || getQuizIdFromUrl();
  if (!quizId) {
    console.error("Missing quizId (expected window.DSA_BOOT or ?quizId=...)");
    return;
  }

  const cfg = boot?.cfg || null;
  const bankUrl = boot?.bankUrl || cfg?.bank;
  if (!cfg || !bankUrl) {
    console.error("Missing cfg/bankUrl (expected window.DSA_BOOT = { quizId, cfg, bankUrl })");
    return;
  }

  // Load the bank
  const bank = await loadJson(bankUrl);

  // Choose questions
  const questions = pickQuestionsFromBank(bank, cfg);
  if (!questions.length) {
    console.error("Bank loaded but contained no questions:", bankUrl);
    return;
  }

  // Provide runtime config expected by your quiz engine
  setEngineConfig({
    quizId,
    title: cfg.title || bank.title || "Quiz",
    sectionTitle: cfg.sectionTitle || cfg.title || bank.title || "Quiz",
    timeLimitSec: cfg.timeLimitSec ?? null,
    questions,
  });

  await import("/assets/js/quiz-engine.js");
})().catch((err) => console.error("Quiz init failed:", err));
