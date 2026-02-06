// /assets/js/quiz-registry.js
// Defines the canonical quiz registry used by /assets/js/quiz-engine.js.
//
// Contract:
// - Must define window.QUIZ_REGISTRY (preferred) as an object:
//     { [quizId]: { bankUrl, title?, pickCount?, timeLimitSec?, seedMode?, pauseOnBlur? } }
// - quizId should match:
//     - ?quizId=circles
//     - or location.hash "#circles"
//     - or folder fallback: /practice/circles/quiz.html -> "circles"

(function () {
  "use strict";

  // -----------------------
  // Registry (edit/add here)
  // -----------------------
  const REGISTRY = {
    circles: {
      title: "Circles",
      bankUrl: "/assets/questionbank/math/circles.json",
      pickCount: 20,        // how many questions to draw (default: all in bank)
      timeLimitSec: 0,      // 0 = no timer (or set to e.g. 32*60)
      seedMode: null,       // null | "perAttempt" | "perQuiz"
      pauseOnBlur: false    // if true, timer pauses when tab loses focus
    }

    // Example:
    // lines: {
    //   title: "Linear Equations",
    //   bankUrl: "/assets/questionbank/math/lines.json",
    //   pickCount: 15,
    //   timeLimitSec: 20 * 60,
    //   seedMode: "perQuiz",
    //   pauseOnBlur: true
    // }
  };

  // -----------------------
  // Light validation (keeps failures obvious)
  // -----------------------
  function isPlainObject(x) {
    return !!x && typeof x === "object" && !Array.isArray(x);
  }

  function validateRegistry(registry) {
    if (!isPlainObject(registry)) return "QUIZ_REGISTRY must be an object.";
    const keys = Object.keys(registry);
    if (!keys.length) return "QUIZ_REGISTRY has no entries.";

    for (const quizId of keys) {
      const cfg = registry[quizId];
      if (!isPlainObject(cfg)) return `Registry entry "${quizId}" must be an object.`;

      const bankUrl = cfg.bankUrl || cfg.jsonUrl || cfg.url;
      if (!bankUrl || typeof bankUrl !== "string") {
        return `Registry entry "${quizId}" is missing bankUrl (string).`;
      }

      if (cfg.pickCount != null && !Number.isFinite(Number(cfg.pickCount))) {
        return `Registry entry "${quizId}" has invalid pickCount.`;
      }

      if (cfg.timeLimitSec != null && !Number.isFinite(Number(cfg.timeLimitSec))) {
        return `Registry entry "${quizId}" has invalid timeLimitSec.`;
      }

      if (cfg.seedMode != null && cfg.seedMode !== "perAttempt" && cfg.seedMode !== "perQuiz") {
        return `Registry entry "${quizId}" seedMode must be null, "perAttempt", or "perQuiz".`;
      }
    }

    return null;
  }

  const err = validateRegistry(REGISTRY);
  if (err) {
    console.error("[quiz-registry] Invalid registry:", err);
    // Still publish it to window so your loader can show a helpful error,
    // but leave a loud console signal.
  }

  // -----------------------
  // Publish
  // -----------------------
  try {
    // Prefer the canonical name:
    window.QUIZ_REGISTRY = REGISTRY;

    // Optional compatibility alias (if any older pages referenced it):
    window.quizRegistry = REGISTRY;
  } catch (e) {
    console.error("[quiz-registry] Failed to publish registry:", e);
  }

  // Optional: freeze so accidental runtime mutation doesn’t happen
  try {
    Object.freeze(REGISTRY);
    for (const k of Object.keys(REGISTRY)) Object.freeze(REGISTRY[k]);
  } catch {}
})();
