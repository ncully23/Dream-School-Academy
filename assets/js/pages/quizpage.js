// /assets/js/pages/quizPage.js
(function () {
  const params = new URLSearchParams(window.location.search);
  const quizId = params.get("quizId");

  // Simple fallback behavior:
  if (!quizId) {
    console.warn("quizPage: missing ?quizId=... redirecting to practice hub");
    window.location.href = "/pages/practice.html";
    return;
  }

  // STEP #2: minimal hardcoded config map.
  // STEP #3 will replace this with fetched configs + fetched question bank(s).
  const QUIZ_MAP = {
    "topic.circles": {
      quizId: "topic.circles",
      title: "Section 1, Module 1: Math — Circles (Practice)",
      mode: "practice",               // "practice" | "exam"
      domain: "math",
      topic: "circles",

      // Quiz behavior
      timeLimitSec: 14 * 60,
      questionCount: 10,

      // Data sources (bank files)
      sources: ["/assets/question-bank/math/circles.json"],

      // UI hints (optional)
      showPracticeBanner: true
    }
  };

  const cfg = QUIZ_MAP[quizId];
  if (!cfg) {
    console.warn("quizPage: unknown quizId:", quizId);
    window.location.href = "/pages/practice.html";
    return;
  }

  // Expose the config for your engine to use.
  // (Your current engine may still look for window.examConfig; in that case
  // add a small bridge in quiz-engine.js: const cfg = window.dsaQuizConfig || window.examConfig)
  window.dsaQuizConfig = cfg;

  // Update visible titles immediately (helps perceived performance).
  const titleEl = document.getElementById("sectionTitle");
  if (titleEl) titleEl.textContent = cfg.title;

  const checkTitleEl = document.getElementById("checkTitle");
  if (checkTitleEl) checkTitleEl.textContent = `${cfg.title} Questions`;

  const popTitleEl = document.getElementById("popTitle");
  if (popTitleEl) popTitleEl.textContent = `${cfg.title} Questions`;

  // Page <title>
  document.title = cfg.title || "Quiz";

  // Practice banner toggle (we'll do richer mode handling later)
  const practiceBanner = document.getElementById("practiceBanner");
  if (practiceBanner) {
    practiceBanner.style.display = cfg.showPracticeBanner ? "flex" : "none";
  }
})();
