// /assets/js/quiz-registry.js
//
// Central registry mapping ?quizId=... -> quiz configuration.
// quiz.html loads this file and expects it to define window.QUIZ_REGISTRY.
//
// Scales to many quizzes:
// - Add one entry per quizId
// - Each entry points to a bank JSON (today: a single file like circles.json)
// - Later, you can migrate to folder-based index.json without changing quiz.html

(function initQuizRegistry() {
  const ORIGIN = window.location.origin;

  // Helper: ensure absolute paths resolve correctly in prod + local.
  const abs = (path) => {
    if (!path) return path;
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    if (path.startsWith("/")) return path; // absolute to site root
    return new URL(path, ORIGIN).pathname;
  };

  // ---- Registry ----
  // Each key is the quizId used in: /quiz.html?quizId=<key>
  window.QUIZ_REGISTRY = {
    // =========================
    // Math — Circles (topic quiz)
    // =========================
    circles: {
      quizId: "circles",

      // UI
      title: "Math — Circles",
      subtitle: "Practice Set",
      directions:
        "Answer the questions. Use Mark for review and Eliminate if helpful. When finished, End & Score to see feedback.",

      // Where the engine should load questions from:
      // Today: a single bank file containing { bankId, ... , questions:[...] }
      bankUrl: abs("/assets/questionbank/math/circles.json"),

      // Selection behavior
      pickCount: 10,              // pick 10 questions from the bank
      shuffleQuestions: true,     // randomize which 10 + their order
      shuffleChoices: false,      // set true only if your choices are safe to shuffle
                                 // (if you do, engine must also update answerIndex accordingly)

      // Filters (optional now, powerful later)
      // These correspond to fields you already have: skill, difficulty, topic
      // Leave empty arrays to mean "no filter".
      filters: {
        skills: [],               // e.g. ["area", "circumference"]
        difficulty: [],           // e.g. ["easy","medium"]
        topic: ["math.circles"]   // helpful guardrail if a bank grows multi-topic later
      },

      // Timer
      // If null/0, engine can treat as untimed.
      timeLimitSec: 15 * 60,      // 15 minutes for a 10-question set (adjust as you like)

      // Persistence keys (keeps attempt/session separation clean)
      // Engine can use these to standardize storage paths in localStorage/Firestore.
      storage: {
        sectionId: "math.circles",
        attemptPrefix: "dsa:attempt:",
        draftPrefix: "dsa:draft:"
      },

      // Versioning / analytics hooks (optional)
      version: 1
    }

    // =========================
    // Add more quizzes like this
    // =========================
    // algebra_linear: { ... },
    // grammar_commas: { ... }
  };

  // Optional convenience alias for older code
  window.quizRegistry = window.QUIZ_REGISTRY;
})();
