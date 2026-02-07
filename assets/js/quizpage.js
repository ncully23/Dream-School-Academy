// /assets/js/quizpage.js

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function getQuizIdFromUrl() {
  const params = new URLSearchParams(location.search);
  return params.get("quizId");
}

function pickQuestions(bank, cfg) {
  if (!bank || !Array.isArray(bank.questions)) return [];
  const n = Number(cfg.pickCount || cfg.pick || cfg.count || bank.questions.length);
  return bank.questions.slice(0, n);
}

(async function initQuiz() {
  // 1) Prefer the boot payload from quiz.html
  const boot = window.DSA_BOOT || null;

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

  // 2) Load the bank
  const bank = await loadJson(bankUrl);

  // 3) Choose questions
  const questions = pickQuestions(bank, cfg);

  if (!questions.length) {
    console.error("Bank loaded but contained no questions:", bankUrl);
    return;
  }

  // 4) Provide runtime config expected by your quiz engine
  window.dsaQuizConfig = {
    quizId,
    sectionId: quizId,
    title: cfg.title || bank.title || "Quiz",
    sectionTitle: cfg.sectionTitle || cfg.title || bank.title || "Quiz",
    timeLimitSec: cfg.timeLimitSec ?? null,

    storageKey: `dsa:draft:${quizId}`,

    pauseOnBlur: false,
    allowDraftSave: false,
    questions
  };

  document.title = window.dsaQuizConfig.sectionTitle;

  // 5) If your engine is not already imported elsewhere, import it here:
  // await import("/assets/js/quiz-engine.js");

})().catch((err) => console.error("Quiz init failed:", err));
