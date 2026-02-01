// assets/js/pages/quizpage.js
async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function getQuizId() {
  const params = new URLSearchParams(location.search);
  return params.get("quizId");
}

// -------------
// Step 7: decouple UI paths from config
// No summaryHref/reviewHref in config.
// Engine redirects to /pages/review.html?attemptId=...
// -------------

// Minimal quiz registry (in code) until you choose to re-introduce quizzes.json.
// Key = quizId in URL, Value = metadata + bank path.
const QUIZ_REGISTRY = {
  "math.circles.practice": {
    quizId: "math.circles.practice",
    title: "Circles (Practice)",
    sectionTitle: "Section 1, Module 1: Math — Circles (Practice)",
    timeLimitSec: 14 * 60,
    bank: "/assets/question-bank/math/circles.json"
  }

  // Add more here:
  // "math.linear_functions.practice": { ... bank: "/assets/question-bank/math/linear-functions.json" }
  // "rw.module1.practice": { ... bank: "/assets/question-bank/reading/module1.json", timeLimitSec: 32*60 }
};

function pickQuestions(bank, meta) {
  // For now: use all questions in the bank.
  // Later: sampling, difficulty targeting, etc.
  if (!bank || !Array.isArray(bank.questions)) return [];
  return bank.questions;
}

(async function initQuiz() {
  const quizId = getQuizId();
  if (!quizId) {
    console.error("Missing ?quizId=...");
    return;
  }

  // 1) Resolve quiz meta (no quizzes.json required)
  const meta = QUIZ_REGISTRY[quizId];
  if (!meta) {
    console.error(`Unknown quizId: ${quizId}`);
    return;
  }

  // 2) Load the bank
  const bank = await loadJson(meta.bank);

  // 3) Choose questions
  const questions = pickQuestions(bank, meta);

  // 4) Assemble runtime config for the engine
  // Step 6 keys: dsa:draft:{quizId}, dsa:attempt:{attemptId}
  window.dsaQuizConfig = {
    quizId: meta.quizId,
    sectionId: meta.quizId, // ok for now
    title: meta.title,
    sectionTitle: meta.sectionTitle,
    timeLimitSec: meta.timeLimitSec,

    // Standard draft key (Step 6)
    storageKey: `dsa:draft:${meta.quizId}`,

    pauseOnBlur: false,
    allowDraftSave: false, // you want "start fresh"
    questions
  };

  document.title = meta.sectionTitle || meta.title || "Quiz";
})().catch((err) => console.error("Quiz init failed:", err));
