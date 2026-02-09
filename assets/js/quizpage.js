// /assets/js/pages/quizpage.js
// Dream School Academy — quiz loader (topic quizId + random mode)
//
// Supports:
// 1) Topic mode:  /pages/quiz.html?quizId=...  (or window.DSA_BOOT)
// 2) Random mode: /pages/quiz.html?mode=random&section=math&count=10&difficulty=hard&untimed=1
//
// Random mode loads /assets/questionbank/math/banks.math.json and samples across all listed banks.
// Missing banks (404) are skipped.
//
// IMPORTANT (progress/attempt saving):
// - Always generates a unique attemptId per run.
// - Provides enough metadata for quiz-engine.js + attempt-writer.js to save a complete attempt payload.
// - Random mode provides deterministic picking info via cfg.seedMode/seedValue + pick.picked list.

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
  return (params.get("mode") || "").toLowerCase() === "random";
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
   Minimal UI error (avoid "silent Loading...")
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
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeAttemptId() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return `att_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/* -----------------------------
   Small utilities
------------------------------ */

function asArray(x) {
  return Array.isArray(x) ? x : x ? [x] : [];
}

function safeStr(x) {
  return typeof x === "string" ? x : "";
}

/* -----------------------------
   Deterministic RNG for random picking
   (so pick list is reproducible given seedValue)
------------------------------ */

function hash32(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/* -----------------------------
   Question normalization
------------------------------ */

function fallbackQuestionId(q) {
  // Prefer stable fields; avoid randomness (so review links remain consistent)
  const base =
    safeStr(q?.questionId) ||
    safeStr(q?.id) ||
    `${safeStr(q?.topic)}|${safeStr(q?.skill)}|${safeStr(q?.prompt).slice(0, 80)}`;
  return `Q_${hash32(base).toString(16)}`;
}

function normalizeQuestion(q, bankMeta) {
  // Banks may use answerIndex; engine expects correctIndex.
  const correctIndex =
    Number.isFinite(q?.correctIndex) ? q.correctIndex :
    Number.isFinite(q?.answerIndex) ? q.answerIndex :
    null;

  const questionId = safeStr(q?.questionId) || safeStr(q?.id) || fallbackQuestionId(q);

  // Version is REQUIRED in attempt schema (questionId + version)
  const version =
    Number.isFinite(q?.version) ? q.version :
    Number.isFinite(bankMeta?.bankVersion) ? bankMeta.bankVersion :
    1;

  const out = {
    ...q,
    questionId,
    version,
    correctIndex,
  };

  // Carry source bank meta (useful for random mixed banks + review tooling)
  if (bankMeta) {
    out.__sourceBankId = bankMeta.bankId || null;
    out.__sourceBankVersion = Number.isFinite(bankMeta.bankVersion) ? bankMeta.bankVersion : null;
    out.__sourceBankTitle = bankMeta.title || null;
    out.__sourceBankUrl = bankMeta.__bankUrl || null;
  }

  return out;
}

function isRunnableQuestion(q) {
  return (
    typeof q?.prompt === "string" &&
    Array.isArray(q?.choices) &&
    q.choices.length >= 2 &&
    Number.isFinite(q?.correctIndex) &&
    typeof q?.questionId === "string" &&
    q.questionId.length > 0 &&
    Number.isFinite(q?.version)
  );
}

/* -----------------------------
   Topic mode: pick questions from a single bank
------------------------------ */

function pickQuestionsFromBank(bank, cfg) {
  if (!bank || !Array.isArray(bank.questions)) return [];

  const bankMeta = {
    bankId: bank?.bankId || bank?.topic || null,
    bankVersion: bank?.bankVersion ?? bank?.version ?? null,
    title: bank?.title || null,
  };

  const desired =
    Number(cfg?.pickCount ?? cfg?.pick ?? cfg?.count ?? bank.questions.length);
  const pickCount = Number.isFinite(desired) ? Math.max(1, Math.min(60, desired)) : bank.questions.length;

  const qs = bank.questions.slice().map((q) => normalizeQuestion(q, bankMeta));

  // Respect shuffle if you later set it true in boot cfg
  if (cfg?.shuffle) {
    const rand = mulberry32(hash32("topic-shuffle"));
    shuffleInPlace(qs, rand);
  }

  const sliced = qs.slice(0, pickCount).filter(isRunnableQuestion);
  return sliced;
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
    const bankMeta = {
      bankId: b?.bankId || b?.topic || null,
      bankVersion: b?.bankVersion ?? b?.version ?? null,
      title: b?.title || null,
      __bankUrl: b?.__bankUrl || null,
    };

    const qs = asArray(b?.questions);
    for (const q of qs) all.push(normalizeQuestion(q, bankMeta));
  }
  return all;
}

function filterQuestionsForRandom(pool, settings) {
  let out = pool;

  // Section gate (expects topics like "math.circles")
  if (settings.section === "math") {
    out = out.filter((q) => safeStr(q?.topic).startsWith("math."));
  }

  if (settings.difficulty) {
    out = out.filter((q) => safeStr(q?.difficulty).toLowerCase() === settings.difficulty);
  }

  // Must be runnable
  out = out.filter(isRunnableQuestion);

  return out;
}

function sampleUniqueDeterministic(pool, n, seedValue) {
  const copy = pool.slice();
  const rand = mulberry32(hash32(String(seedValue)));
  shuffleInPlace(copy, rand);
  return copy.slice(0, n);
}

/* -----------------------------
   Build engine config
------------------------------ */

function setEngineConfig({
  quizId,
  attemptId,
  attemptType, // "topic" | "random"

  title,
  sectionTitle,
  description,
  timeLimitSec,

  bank,        // { bankId, bankVersion, title }
  pick,        // random-only: { pickCount, seedMode, seedValue, picked: [...] }

  questions,
}) {
  // Draft key: keep unique per attempt to prevent collisions for random (and for repeated topic runs).
  // Attempts are always stored as dsa:attempt:{attemptId}.
  const storageKey = `dsa:draft:${quizId}:${attemptId}`;

  window.dsaQuizConfig = {
    // core identity
    quizId,
    sectionId: quizId,
    mode: attemptType === "random" ? "random" : "topic",
    attemptType,
    attemptId,
    attemptKey: attemptId ? `dsa:attempt:${attemptId}` : null,

    // titles
    title: title || "Quiz",
    sectionTitle: sectionTitle || title || "Quiz",
    description: description || "",

    // timing (0 disables timer in most implementations)
    timeLimitSec: Number.isFinite(timeLimitSec) ? timeLimitSec : null,

    // storage
    storageKey,

    // attempt payload helpers (quiz-engine uses these when building attempt object)
    bank: bank || { bankId: null, bankVersion: null, title: null },
    pick: pick || null,

    pauseOnBlur: false,
    allowDraftSave: false,

    // normalized questions
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

  // -----------------------------
  // RANDOM MODE
  // -----------------------------
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

    // Unique attempt per run
    const attemptId = makeAttemptId();

    // Deterministic seed per attempt (so pick list is reconstructable)
    const seedMode = "perAttempt";
    const seedValue = attemptId;

    const sampled = sampleUniqueDeterministic(pool, settings.count, seedValue);

    const quizId = "random.math";
    const title = "Random Math Practice";
    const sectionTitle = settings.untimed ? "Untimed · Random Math" : "Random Math";
    const timeLimitSec = settings.untimed ? 0 : null;

    // “Mixed” bank metadata for attempt schema
    const bank = {
      bankId: "math.random",
      bankVersion: 1,
      title: "Math — Mixed Banks",
    };

    const description =
      `Randomized practice across all Math banks. ` +
      `count=${settings.count}` +
      (settings.difficulty ? `, difficulty=${settings.difficulty}` : ``) +
      (settings.untimed ? `, untimed` : ``) +
      `. updatedAt=${nowISODate()}.`;

    // pick block required by your attempt schema for randomized attempts
    const pick = {
      pickCount: settings.count,
      seedMode,
      seedValue,
      picked: sampled.map((q) => ({ questionId: q.questionId, version: q.version })),
    };

    setEngineConfig({
      quizId,
      attemptId,
      attemptType: "random",
      title,
      sectionTitle,
      description,
      timeLimitSec,
      bank,
      pick,
      questions: sampled,
    });

    await import("/assets/js/quiz-engine.js");
    return;
  }

  // -----------------------------
  // TOPIC MODE (normal quizId flow)
  // -----------------------------
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

  let bankPayload;
  try {
    bankPayload = await loadJson(bankUrl);
  } catch (err) {
    renderFatal(err?.message || err);
    return;
  }

  const questions = pickQuestionsFromBank(bankPayload, cfg);
  if (!questions.length) {
    renderFatal(`Bank loaded but contained no runnable questions: ${bankUrl}`);
    return;
  }

  // Unique attempt per run (so topic attempts don’t collide)
  const attemptId = makeAttemptId();

  const bank = {
    bankId: bankPayload?.bankId || bankPayload?.topic || quizId,
    bankVersion: bankPayload?.bankVersion ?? bankPayload?.version ?? null,
    title: bankPayload?.title || cfg?.title || "Quiz",
  };

  setEngineConfig({
    quizId,
    attemptId,
    attemptType: "topic",
    title: cfg.title || bankPayload.title || "Quiz",
    sectionTitle: cfg.sectionTitle || cfg.title || bankPayload.title || "Quiz",
    description: bankPayload?.description || cfg?.description || "",
    timeLimitSec: cfg.timeLimitSec ?? null,
    bank,
    pick: null, // topic attempts do not require pick[]
    questions,
  });

  await import("/assets/js/quiz-engine.js");
})().catch((err) => renderFatal(err?.message || err));
