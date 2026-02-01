async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function getQuizId() {
  const params = new URLSearchParams(location.search);
  return params.get("quizId");
}

function pickQuestions(bank, quizMeta) {
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

  // 1) Load the registry
  const registry = await loadJson("/assets/configs/quizzes.json");
  const meta = registry[quizId];

  if (!meta) {
    console.error(`Unknown quizId: ${quizId}`);
    return;
  }

  // 2) Load the bank
  const bank = await loadJson(meta.bank);

  // 3) Choose questions
  const questions = pickQuestions(bank, meta);

  // 4) Assemble runtime config for the engine
  window.dsaQuizConfig = {
    quizId: meta.quizId,
    sectionId: meta.quizId,              // ok for now; later you can separate
    title: meta.title,
    sectionTitle: meta.sectionTitle,
    timeLimitSec: meta.timeLimitSec,

    // Step 6 will standardize these keys; OK to keep your current ones for now
    storageKey: meta.storageKey || `dsa:${meta.quizId}:draft`,
    summaryKey: meta.summaryKey || `dsa:${meta.quizId}:summary`,
    summaryHref: meta.summaryHref || "/pages/review.html", // Step 7 removes hardcoding

    pauseOnBlur: false,
    allowDraftSave: false,               // you wanted "start fresh"
    questions
  };

  // Optional: set document title
  document.title = meta.sectionTitle || meta.title || "Quiz";

  // 5) Start engine only after config exists
  await import("/assets/js/quiz-engine.js");
})().catch((err) => console.error("Quiz init failed:", err));
