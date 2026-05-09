// /assets/js/quiz-engine.js

// Import the central routes helper so we never hardcode URL paths in this file.
import { routes } from "/assets/js/lib/routes.js";
// Import the dedicated attempt writer that handles Firestore + localStorage saves with retry/diagnostic logic.
import { saveAttempt } from "/assets/js/lib/attempt-writer.js";

// IIFE: wraps the whole engine in a private scope so its internals don't leak onto window.
(function () {
  "use strict"; // enables strict mode — catches silent errors like assigning to undeclared variables

  // =========================================================
  // Quiz Engine (scalable):
  // - Resolves quizId from: ?quizId -> #hash -> /practice/<id>/quiz.html
  //   -> localStorage last -> first registry key
  // - Looks up config in window.QUIZ_REGISTRY (from quiz-registry.js)
  // - Fetches JSON bank
  // - Picks N questions randomly (optionally seeded)
  // - Runs Bluebook-style UI
  // - Saves attempt (authoritative):
  //      saveAttempt() -> Firestore users/{uid}/attempts/{attemptId}
  //                   -> localStorage dsa:attempt:{attemptId} (fallback/diagnostic)
  // - Redirects to review: /pages/review.html?attemptId=...
  //
  // This revision:
  // - Surfaces the REAL save failure (code/message/path) instead of generic "sign-in"
  // - Emits a one-line auth diagnostic when save fails
  // - Prevents duplicate save banners on repeated failures
  // - Sanitizes items fields that often create Firestore invalid-argument (undefined)
  // =========================================================

  // -----------------------
  // 0) URL + registry helpers
  // -----------------------

  // Reads the "quizId" value from the page URL's query string (e.g., ?quizId=algebra-1).
  // Returns null if absent or if URL parsing fails.
  function getQuizIdFromUrl() {
    try {
      return new URLSearchParams(location.search).get("quizId"); // standard query-string parser
    } catch {
      return null; // never crash on malformed URLs
    }
  }

  // Reads the quizId from the URL's hash fragment (e.g., #algebra-1).
  // Strips the leading "#" and any whitespace, returning null if empty.
  function getQuizIdFromHash() {
    try {
      const h = (location.hash || "").replace(/^#/, "").trim();
      return h || null;
    } catch {
      return null;
    }
  }

  // Tries to extract a quizId from a path like /practice/algebra-1/quiz.html.
  // Splits the path, finds "practice", and returns the segment immediately after it.
  function getQuizIdFromPathFallback() {
    try {
      const parts = location.pathname.split("/").filter(Boolean); // drop empty segments from leading/trailing slashes
      const practiceIdx = parts.indexOf("practice"); // locate the "practice" segment
      if (practiceIdx >= 0 && parts.length > practiceIdx + 1) {
        const candidate = parts[practiceIdx + 1]; // grab whatever comes right after "practice"
        if (candidate && candidate !== "quiz.html") return candidate; // skip the file name itself
      }
      return null;
    } catch {
      return null;
    }
  }

  // Reads the most recently used quizId from localStorage (set by setLastQuizId below).
  // Used as a "remember the last quiz" fallback.
  function getLastQuizId() {
    try {
      return localStorage.getItem("dsa:lastQuizId");
    } catch {
      return null; // localStorage may throw in private mode
    }
  }

  // Stores the current quizId in localStorage so we can recall it on the next visit.
  // Wrapped in try/catch and converts to string defensively.
  function setLastQuizId(quizId) {
    try {
      localStorage.setItem("dsa:lastQuizId", String(quizId));
    } catch {} // silently ignore storage errors
  }

  // If no quizId can be determined any other way, fall back to the first key in the registry object.
  function getDefaultQuizId(registry) {
    if (!registry) return null;
    const keys = Object.keys(registry);
    return keys.length ? keys[0] : null; // first available quiz, or null if registry is empty
  }

  // Looks up the global quiz registry object, supporting several possible global names
  // for backwards compatibility with older code.
  function getRegistry() {
    return window.QUIZ_REGISTRY || window.quizRegistry || window.QUIZZES || null;
  }

  // Resolves the active quizId by trying each source in priority order:
  // URL query → URL hash → URL path → localStorage → registry default.
  // Short-circuits on the first non-null result thanks to the || chain.
  function resolveQuizId(registry) {
    return (
      getQuizIdFromUrl() ||
      getQuizIdFromHash() ||
      getQuizIdFromPathFallback() ||
      getLastQuizId() ||
      getDefaultQuizId(registry)
    );
  }

  // Builds the URL of the review page for a given attempt.
  // Prefers the central routes helper if available, falls back to a hardcoded path.
  function resolveReviewUrl(attemptId) {
    try {
      if (routes && typeof routes.review === "function") return routes.review(attemptId);
    } catch {}
    return `/pages/review.html?attemptId=${encodeURIComponent(attemptId)}`; // safe URL encoding
  }

  // Generic JSON fetcher that disables the cache and throws on non-2xx responses.
  // "no-store" guarantees we always get the latest question bank, never a stale cached copy.
  async function loadJson(url) {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
    return res.json();
  }

  // -----------------------
  // 1) Random picking (seeded optional)
  // -----------------------

  // Hashes a string into a 32-bit unsigned integer using the FNV-1a algorithm.
  // Used as a seed input for the deterministic RNG below.
  function hashStringToUint32(str) {
    let h = 2166136261; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i); // XOR in the next character
      h = Math.imul(h, 16777619); // multiply by FNV prime (Math.imul handles 32-bit overflow correctly)
    }
    return h >>> 0; // coerce to unsigned 32-bit
  }

  // Mulberry32: a tiny, fast, high-quality seeded pseudo-random number generator.
  // Returns a function that produces a new float in [0, 1) on each call.
  function mulberry32(seed) {
    let a = seed >>> 0; // ensure unsigned 32-bit starting state
    return function () {
      a |= 0; // force 32-bit integer math
      a = (a + 0x6d2b79f5) | 0; // advance internal state
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // normalize to [0, 1)
    };
  }

  // In-place Fisher–Yates shuffle, parameterized over an RNG so it can be deterministic when seeded.
  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)); // pick a random index 0..i
      [arr[i], arr[j]] = [arr[j], arr[i]]; // swap elements using array destructuring
    }
    return arr;
  }

  // Selects N questions from a bank with optional seeding for reproducibility.
  // - "perAttempt" → same questions if you reopen the same attempt
  // - "perQuiz" → same questions for everyone taking this quiz
  // - default → fresh random pick every time
  function pickQuestionsFromBank(bank, cfg, attemptIdForSeed) {
    if (!bank || !Array.isArray(bank.questions)) return [];

    const all = bank.questions.slice(); // copy so we don't mutate the original bank
    const pickCount = Number(cfg.pickCount || cfg.count || 0) || all.length;

    const seedMode = cfg.seedMode || null;

    let rng = Math.random; // default: non-deterministic
    if (seedMode === "perAttempt" && attemptIdForSeed) {
      rng = mulberry32(hashStringToUint32(String(attemptIdForSeed))); // deterministic per attempt
    } else if (seedMode === "perQuiz" && cfg.__quizId) {
      rng = mulberry32(hashStringToUint32(String(cfg.__quizId))); // deterministic per quiz
    }

    shuffleInPlace(all, rng); // shuffle with the chosen RNG

    const n = Math.max(0, Math.min(pickCount, all.length)); // clamp to a safe range
    return all.slice(0, n); // take the first N after shuffling
  }

  // -----------------------
  // 2) Storage keys (draft-only; attempts handled by attempt-writer)
  // -----------------------

  // Generates a fairly unique attempt ID by combining timestamp and a random number.
  function createAttemptId() {
    return "t_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  }

  // Builds the localStorage key used to store an in-progress draft for a given quiz.
  function getDraftKey(quizId) {
    return `dsa:draft:${quizId}`;
  }

  // Removes an item from localStorage without throwing if access fails.
  function safeRemoveStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  // -----------------------
  // 3) DOM cache
  // -----------------------

  // Cache references to every DOM element the engine touches, in one tidy object.
  // This avoids repeated getElementById calls and makes the script's DOM dependencies obvious at a glance.
  const el = {
    sectionTitle: document.getElementById("sectionTitle"), // header showing the quiz name
    timeLeft: document.getElementById("timeLeft"), // countdown display
    toggleTimer: document.getElementById("toggleTimer"), // show/hide timer button

    qcard: document.getElementById("qcard"), // the active question card
    qbadge: document.getElementById("qbadge"), // small badge showing question number
    qtitle: document.getElementById("qtitle"), // question prompt
    choices: document.getElementById("choices"), // container for answer choices
    flagTop: document.getElementById("flagTop"), // "mark for review" button
    flagLabel: document.getElementById("flagLabel"), // text label next to flag
    elimToggle: document.getElementById("elimToggle"), // strikethrough mode toggle
    elimHint: document.getElementById("elimHint"), // hint text for elimination mode

    back: document.getElementById("btnBack"), // previous question button
    next: document.getElementById("btnNext"), // next question button
    finish: document.getElementById("btnFinish"), // finish exam button (replaces Next on last question)

    progress: document.getElementById("progress"), // segmented progress bar
    pill: document.getElementById("centerPill"), // center pill that opens the navigator
    pillText: document.getElementById("pillText"), // "Question X of Y" text in the pill
    pillFlag: document.getElementById("pillFlag"), // small flag icon in the pill

    pop: document.getElementById("popover"), // navigator popover
    popGrid: document.getElementById("popGrid"), // grid of question buttons inside popover
    popClose: document.getElementById("popClose"), // close button for popover
    goReview: document.getElementById("goReview"), // "go to review page" button

    checkPage: document.getElementById("checkPage"), // full review page (alternate view)
    checkGrid: document.getElementById("checkGrid"), // grid of question buttons on review page

    dashrow: document.getElementById("dashrow"), // decorative dash row at the top

    popTitle: document.getElementById("popTitle"), // title shown above popover grid
    checkTitle: document.getElementById("checkTitle"), // title shown above review-page grid
  };

  // Replaces HTML-significant characters with their entity equivalents so user/dynamic
  // strings can be safely injected via innerHTML without enabling XSS.
  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Displays a fatal error banner at the top of the page when the quiz can't load.
  // Also resets the page title and clears the timer display so users aren't confused.
  function showFatal(message) {
    console.error("[quiz-engine] " + message); // log to console for debugging
    const box = document.createElement("div");
    box.style.cssText =
      "max-width:980px;margin:14px auto;padding:12px 14px;background:#fff;border:1px solid #c00;border-radius:10px;" +
      "font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:#111;";
    // escapeHtml() prevents the message itself from injecting HTML
    box.innerHTML = `<h2 style="margin:0 0 6px;font-size:18px">Quiz failed to load</h2><p style="margin:0">${escapeHtml(
      String(message)
    )}</p>`;
    (document.body || document.documentElement).prepend(box); // inject at the top of the page

    if (el.sectionTitle) el.sectionTitle.textContent = "Quiz failed to load";
    if (el.timeLeft) el.timeLeft.textContent = "--:--";
    document.title = "Quiz failed to load"; // update browser tab title too
  }

  // Holds a reference to the current save-failure banner so we can replace it instead of stacking duplicates.
  let __saveBannerEl = null;

  // Removes the existing save-failure banner from the DOM, if any.
  function removeSaveBanner() {
    try {
      if (__saveBannerEl && __saveBannerEl.parentNode) __saveBannerEl.parentNode.removeChild(__saveBannerEl);
    } catch {}
    __saveBannerEl = null; // clear the reference
  }

  // Renders a save-failure banner with title, friendly message, optional technical details, and a "Retry save" button.
  // Always removes any existing banner first so repeated failures don't pile up on the screen.
  function showSaveBanner({ title, message, details, onRetry }) {
    removeSaveBanner();

    console.error("[quiz-engine] save failed:", { title, message, details }); // structured log for devs

    const box = document.createElement("div");
    box.style.cssText =
      "max-width:980px;margin:14px auto;padding:12px 14px;background:#fff;border:1px solid #eab308;border-radius:10px;" +
      "font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:#111;" +
      "display:flex;align-items:flex-start;justify-content:space-between;gap:10px;";

    // Optional details block — only rendered if `details` was provided.
    const detailsHtml = details
      ? `<div style="margin-top:8px;font-size:12px;opacity:.85;white-space:pre-wrap">${escapeHtml(details)}</div>`
      : "";

    // Build the banner's inner HTML — every dynamic piece is escaped first.
    box.innerHTML = `
      <div style="min-width:0">
        <div style="font-weight:700;margin-bottom:2px">${escapeHtml(title || "Couldn't save your attempt")}</div>
        <div style="font-size:14px;opacity:.95">${escapeHtml(
          message || "Your attempt is saved locally, but the cloud save failed."
        )}</div>
        ${detailsHtml}
        <div style="margin-top:8px;font-size:12px;opacity:.8">Tip: open DevTools → Console to see the exact error payload.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <button id="dsaRetrySave" style="padding:10px 12px;border-radius:10px;border:1px solid #111;background:#111;color:#fff;cursor:pointer">Retry save</button>
      </div>
    `.trim();

    const root = document.body || document.documentElement;
    root.prepend(box); // banner appears at the top of the page
    __saveBannerEl = box; // remember it for next removeSaveBanner()

    // Wire up the Retry button to invoke the provided onRetry callback.
    const btn = box.querySelector("#dsaRetrySave");
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.disabled = true; // prevent double-clicks while retrying
        btn.textContent = "Retrying...";
        try {
          await onRetry?.(); // optional-chaining call: only runs if onRetry exists
        } finally {
          btn.disabled = false; // restore button regardless of outcome
          btn.textContent = "Retry save";
        }
      });
    }

    return box;
  }

  // Constrains a number `n` between min and max (inclusive). Tiny but used a lot.
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // -----------------------
  // 4) UI scaffolding
  // -----------------------

  // Builds the decorative row of dashes at the top of the page (54 little divs).
  function buildTicks() {
    if (!el.dashrow) return;
    el.dashrow.innerHTML = ""; // clear any existing dashes
    for (let i = 0; i < 54; i++) {
      const d = document.createElement("div");
      d.className = "dash";
      el.dashrow.appendChild(d);
    }
  }

  // Builds the segmented progress bar with at least 24 segments, scaled up by question count.
  // Sets a CSS variable so styling can adapt to the segment count.
  function buildProgressSkeleton(questionCount) {
    if (!el.progress) return;
    const seg = Math.max(24, questionCount * 2); // minimum 24 segments for visual smoothness
    el.progress.style.setProperty("--seg", seg);
    el.progress.innerHTML = "";
    for (let i = 0; i < seg; i++) {
      const s = document.createElement("div");
      s.className = "seg";
      el.progress.appendChild(s);
    }
  }

  // -----------------------
  // 5) Normalize bank question objects -> engine format
  // -----------------------

  // Coerces a difficulty value into a normalized form: number passes through, strings get
  // lowercased+trimmed, anything else returns null.
  function normalizeDifficulty(raw) {
    if (raw == null) return null;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const s = String(raw).trim().toLowerCase();
    if (!s) return null;
    return s;
  }

  // Converts a single raw question from the bank's JSON shape into the engine's expected shape.
  // Provides defaults and consistent field names so the rest of the engine never has to guess.
  function normalizeQuestion(raw, idx) {
    const questionId = raw.questionId || raw.id || `q_${idx + 1}`; // generate a fallback ID if missing
    const version = raw.version ?? raw.questionVersion ?? 1; // ?? returns the right side ONLY for null/undefined

    const promptText = raw.prompt ?? raw.promptText ?? ""; // plain-text prompt
    const promptHtml = raw.promptHtml ?? null; // optional rich-HTML prompt

    const choices = Array.isArray(raw.choices) ? raw.choices : []; // always an array
    const answerIndex = Number.isFinite(raw.answerIndex) ? raw.answerIndex : null; // valid number or null

    const sol = raw.solution || {}; // legacy solution sub-object
    const explanation = raw.explanation || sol.approach || "";
    const steps = raw.steps || sol.steps || null;

    // Return a clean, predictable shape with both `id` and `questionId` for backward compatibility.
    return {
      id: questionId,
      questionId,
      version,

      topic: raw.topic || null,
      skill: raw.skill || null,
      difficulty: normalizeDifficulty(raw.difficulty),

      promptText,
      promptHtml,

      choices,
      answerIndex,

      explanation,
      steps,
      solution: sol,
    };
  }

  // Convenience wrapper to normalize an entire array of questions at once.
  function normalizeQuestions(list) {
    return (list || []).map((q, i) => normalizeQuestion(q, i));
  }

  // Validates a normalized question array, returning an error message string on failure or null on success.
  // Catches the most common data problems before they crash the renderer.
  function validateQuestions(qs) {
    if (!Array.isArray(qs) || qs.length === 0) return "No questions were loaded.";

    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      if (!q.id) return `Question ${i + 1} is missing questionId/id.`;
      if (!Array.isArray(q.choices) || q.choices.length < 2) return `Question ${q.id} has invalid choices.`;
      if (!Number.isInteger(q.answerIndex)) return `Question ${q.id} has missing/invalid answerIndex.`;
      if (q.answerIndex < 0 || q.answerIndex >= q.choices.length) {
        return `Question ${q.id} answerIndex (${q.answerIndex}) is out of range for ${q.choices.length} choices.`;
      }
    }
    return null; // null means "all good"
  }

  // Decides whether this attempt should be labeled "topic" or "random" based on config and bank metadata.
  // Uses an explicit value if provided, otherwise infers from the presence of random-pick settings.
  function resolveAttemptType(cfg, bank) {
    const explicit = String(cfg?.attemptType || "").trim().toLowerCase();
    if (explicit === "topic" || explicit === "random") return explicit; // explicit wins

    // Heuristic: if you're subselecting/shuffling from a bank, treat as random
    if (cfg && (cfg.random === true || cfg.seedMode || cfg.pickCount || cfg.count)) return "random";

    // If bank explicitly marks itself as random, honor it (optional future)
    if (bank && String(bank.attemptType || "").toLowerCase() === "random") return "random";

    return "topic"; // default
  }

  // -----------------------
  // 6) Core engine (runs after config+bank are loaded)
  // -----------------------

  // The big one: runs the actual quiz UI given a fully prepared `exam` object.
  // Holds all per-attempt state (timer, answers, flags, etc.) inside its closure.
  function runEngine(exam) {
    // Defensive bail-out: if we have no questions, show a fatal banner instead of crashing.
    if (!exam || !Array.isArray(exam.questions) || exam.questions.length === 0) {
      showFatal("No questions found for this quiz.");
      return;
    }

    const quizIdForKeys = String(exam.quizId || exam.sectionId || "unknown-quiz"); // namespace for storage keys
    const draftKey = getDraftKey(quizIdForKeys);

    // Always start fresh (no resume)
    safeRemoveStorage(draftKey); // clear any stale local draft
    if (window.quizData && typeof window.quizData.clearSessionProgress === "function") {
      try {
        // Also clear any remote in-progress session, but don't await or surface errors.
        window.quizData.clearSessionProgress(exam.sectionId).catch(() => {});
      } catch {}
    }

    // Central state object — every piece of mutable per-attempt data lives here.
    // Keeping it in one place makes it easy to reason about and easy to serialize later.
    const state = {
      index: 0, // current question index
      answers: {}, // map of questionId → chosen choice index
      flags: {}, // map of questionId → boolean (marked for review)
      elims: {}, // map of questionId → Set of eliminated choice indexes
      eliminateMode: false, // is "strikethrough" mode currently on?

      remaining: exam.timeLimitSec || 0, // seconds left on the timer
      timerId: null, // setInterval handle so we can stop it
      timerHidden: false, // is the timer currently hidden by the user?
      finished: false, // has the user completed the exam?
      reviewMode: false, // are we showing the review page instead of a question?

      startedAt: Date.now(), // when the attempt began (ms epoch)
      attemptId: exam.attemptId || createAttemptId(), // unique ID for this attempt

      currentQuestionEnterTs: null, // when the user landed on the current question
      questionTimes: {}, // accumulated time-on-question per questionId
      visits: {}, // visit-count per questionId

      // Engagement / focus diagnostics — useful for proctoring or analytics.
      blurCount: 0,
      focusCount: document.hasFocus() ? 1 : 0,
      tabSwitchCount: 0,
      lastBlurAt: null,
      lastFocusAt: document.hasFocus() ? Date.now() : null,
      isFocused: document.hasFocus(),
    };

    // -----------------------
    // Timer
    // -----------------------

    // Renders the timer's MM:SS display, respecting the user's "hide timer" preference.
    function updateTimeDisplay() {
      if (!el.timeLeft) return;
      const m = String(Math.floor(state.remaining / 60)).padStart(2, "0"); // zero-pad minutes
      const s = String(state.remaining % 60).padStart(2, "0"); // zero-pad seconds
      if (!state.timerHidden) {
        el.timeLeft.textContent = `${m}:${s}`;
        el.timeLeft.style.visibility = "visible";
      } else {
        el.timeLeft.style.visibility = "hidden"; // keep layout space, just hide the digits
      }
    }

    // Single tick: decrement by one second and finish the exam if we hit zero.
    function tick() {
      if (state.finished) return;
      state.remaining = Math.max(0, state.remaining - 1);
      if (state.remaining === 0) {
        updateTimeDisplay();
        finishExam();
        return;
      }
      updateTimeDisplay();
    }

    // Starts the 1-second interval timer if not already running and there's time left.
    function startTimer() {
      if (state.timerId || state.finished || !state.remaining) return; // guard against double-start
      updateTimeDisplay();
      state.timerId = setInterval(tick, 1000);
    }

    // Stops the timer and clears the interval handle.
    function stopTimer() {
      if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
      }
    }

    // Wire up the show/hide timer toggle button.
    if (el.toggleTimer && el.timeLeft) {
      el.toggleTimer.addEventListener("click", () => {
        state.timerHidden = !state.timerHidden;
        el.toggleTimer.textContent = state.timerHidden ? "Show" : "Hide";
        updateTimeDisplay();
      });
    }

    // -----------------------
    // View mode
    // -----------------------

    // Switches between the question view and the full review-page view.
    function updateViewMode() {
      if (!el.qcard || !el.checkPage) return;
      if (state.reviewMode) {
        el.qcard.style.display = "none";
        el.checkPage.style.display = "block";
      } else {
        el.qcard.style.display = "";
        el.checkPage.style.display = "none";
      }
    }

    // -----------------------
    // Per-question timing
    // -----------------------

    // Saves how much time was spent on the current question and resets the enter timestamp.
    // Called whenever the user navigates away from a question.
    function commitQuestionTime() {
      const q = exam.questions[state.index];
      if (!q || !state.currentQuestionEnterTs) return;
      const now = Date.now();
      const deltaSec = Math.max(0, Math.round((now - state.currentQuestionEnterTs) / 1000));
      const prev = state.questionTimes[q.id] || 0;
      state.questionTimes[q.id] = prev + deltaSec; // accumulate (handles revisits)
      state.currentQuestionEnterTs = now; // reset for any further time on this same question
    }

    // Marks the user as having entered the current question, incrementing visit count.
    function enterCurrentQuestion() {
      const q = exam.questions[state.index];
      state.currentQuestionEnterTs = Date.now();
      if (!q) return;
      state.visits[q.id] = (state.visits[q.id] || 0) + 1;
    }

    // -----------------------
    // Rendering
    // -----------------------

    // Updates the section title in the header, popover, review page, and browser tab.
    function updateTitles() {
      const title = exam.sectionTitle || exam.title || "";
      if (el.sectionTitle) el.sectionTitle.textContent = title;
      if (el.popTitle) el.popTitle.textContent = title ? `${title} Questions` : "Questions";
      if (el.checkTitle) el.checkTitle.textContent = title ? `${title} Questions` : "Questions";
      if (title) document.title = title;
    }

    // Converts a 0-based index into A/B/C/D... letters for choice labels.
    function letter(i) {
      return String.fromCharCode(65 + i); // 65 is ASCII for "A"
    }

    // Toggles whether choice `idx` of question `qid` is "eliminated" (struck through).
    function toggleElimination(qid, idx) {
      if (!state.elims[qid]) state.elims[qid] = new Set(); // lazy-init the Set on first toggle
      const s = state.elims[qid];
      if (s.has(idx)) s.delete(idx);
      else s.add(idx);
    }

    // Renders the question prompt, preferring rich HTML if provided, otherwise plain text.
    // Using innerHTML for promptHtml is safe here because content comes from our own bank.
    function renderPrompt(q) {
      if (!el.qtitle) return;
      if (q.promptHtml) el.qtitle.innerHTML = q.promptHtml;
      else el.qtitle.textContent = q.promptText || "";
    }

    // Big rendering function: paints the current question, its choices, flag state,
    // elimination state, and triggers MathJax typesetting if available.
    function renderQuestion() {
      const q = exam.questions[state.index];
      if (!q) return;

      if (el.qbadge) el.qbadge.textContent = String(state.index + 1); // 1-based for display
      renderPrompt(q);

      const elimSet = state.elims[q.id] || new Set();

      if (el.choices) {
        // Build all choice HTML in one map+join — single innerHTML write is faster than many appendChild calls.
        el.choices.innerHTML = q.choices
          .map((t, i) => {
            const id = `${q.id}_c${i}`; // unique DOM id for the radio input
            const checked = state.answers[q.id] === i ? "checked" : ""; // restore previous selection
            const elimClass = elimSet.has(i) ? "eliminated" : ""; // restore strikethrough state
            return `
              <label class="choice ${elimClass}" data-choice="${i}" for="${escapeHtml(id)}">
                <input id="${escapeHtml(id)}" type="radio" name="${escapeHtml(q.id)}" value="${i}" ${checked} />
                <div class="text"><b>${letter(i)}.</b> ${escapeHtml(String(t))}</div>
                <div class="letter">${letter(i)}</div>
              </label>
            `;
          })
          .join("");

        // Wire up click + change handlers for every choice, after the HTML is in the DOM.
        el.choices.querySelectorAll(".choice").forEach((choice) => {
          const idx = Number(choice.dataset.choice);
          const input = choice.querySelector("input");

          // Click on the choice (not the radio) toggles elimination when in elim mode.
          choice.addEventListener("click", (ev) => {
            if (!state.eliminateMode) return;
            // Don't intercept clicks on the radio itself — let it select normally.
            if (ev.target && ev.target.tagName && ev.target.tagName.toLowerCase() === "input") return;
            ev.preventDefault();
            toggleElimination(q.id, idx);
            choice.classList.toggle("eliminated");
          });

          // Selecting a radio records the answer and refreshes related UI.
          input.addEventListener("change", () => {
            state.answers[q.id] = idx;
            renderProgress();
            buildPopGrid();
            buildCheckGrid();
          });
        });
      }

      // Reflect flag state on the flag button.
      const flagged = !!state.flags[q.id];
      if (el.flagTop && el.flagLabel) {
        el.flagTop.classList.toggle("on", flagged);
        el.flagTop.setAttribute("aria-pressed", String(flagged)); // a11y
        el.flagLabel.textContent = flagged ? "For review" : "Mark for review";
      }

      // Reflect elimination-mode state on its toggle button + hint.
      if (el.elimToggle && el.elimHint) {
        el.elimToggle.classList.toggle("on", state.eliminateMode);
        el.elimToggle.setAttribute("aria-pressed", String(state.eliminateMode));
        el.elimHint.hidden = !state.eliminateMode;
      }

      // If MathJax is loaded, re-typeset any LaTeX inside the prompt or choices.
      if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([el.qtitle, el.choices]).catch(() => {});
      }
    }

    // Updates the segmented progress bar, the center pill text, the pill flag, and nav buttons.
    function renderProgress() {
      if (!el.progress) return;

      const segs = el.progress.children.length;
      // Calculate how many segments to fill based on current question position.
      const active = Math.ceil(((state.index + 1) / exam.questions.length) * segs);

      for (let i = 0; i < segs; i++) {
        el.progress.children[i].classList.toggle("active", i < active);
      }

      if (el.pillText) el.pillText.textContent = `Question ${state.index + 1} of ${exam.questions.length}`;
      updatePillFlag();
      updateNavs();
    }

    // Shows/hides the small flag indicator on the center pill based on current question's flag state.
    function updatePillFlag() {
      const q = exam.questions[state.index];
      if (!q || !el.pillFlag) return;
      const flagged = !!state.flags[q.id];
      el.pillFlag.style.display = flagged ? "block" : "none";
    }

    // Shows the Finish button on the last question, otherwise shows Next.
    function updateNavs() {
      if (!el.next || !el.finish) return;
      const last = state.index === exam.questions.length - 1 && !state.reviewMode;
      el.next.style.display = last ? "none" : "inline-block";
      el.finish.style.display = last ? "inline-block" : "none";
    }

    // Builds the question-jump grid inside the popover (small floating navigator).
    function buildPopGrid() {
      if (!el.popGrid) return;
      el.popGrid.innerHTML = "";

      exam.questions.forEach((q, i) => {
        const b = document.createElement("button");
        b.className = "nbtn";
        b.textContent = String(i + 1);

        const answered = typeof state.answers[q.id] === "number";
        const flagged = !!state.flags[q.id];

        // Mark current question with a pin icon.
        if (i === state.index) {
          b.classList.add("current");
          const pin = document.createElement("span");
          pin.className = "pin";
          pin.textContent = "📍";
          b.appendChild(pin);
        }
        if (answered) b.classList.add("answered");
        if (flagged) b.classList.add("review");

        // Clicking jumps to that question, exiting review mode if necessary.
        b.addEventListener("click", () => {
          commitQuestionTime();
          state.index = i;
          state.reviewMode = false;
          enterCurrentQuestion();
          closePopover();
          renderAll();
          window.scrollTo(0, 0);
        });

        el.popGrid.appendChild(b);
      });
    }

    // Same as buildPopGrid, but for the full review page (no current-pin, no popover close).
    function buildCheckGrid() {
      if (!el.checkGrid) return;
      el.checkGrid.innerHTML = "";

      exam.questions.forEach((q, i) => {
        const b = document.createElement("button");
        b.className = "nbtn";
        b.textContent = String(i + 1);

        const answered = typeof state.answers[q.id] === "number";
        const flagged = !!state.flags[q.id];

        if (answered) b.classList.add("answered");
        if (flagged) b.classList.add("review");

        b.addEventListener("click", () => {
          commitQuestionTime();
          state.index = i;
          state.reviewMode = false;
          enterCurrentQuestion();
          renderAll();
          window.scrollTo(0, 0);
        });

        el.checkGrid.appendChild(b);
      });
    }

    // Master render: refreshes every part of the UI in the right order.
    function renderAll() {
      updateTitles();
      updateViewMode();
      renderQuestion();
      renderProgress();
      buildPopGrid();
      buildCheckGrid();
      updateTimeDisplay();
    }

    // -----------------------
    // Navigation / controls
    // -----------------------

    // Move forward/back by `delta` questions, with clamping at the boundaries.
    // If the review page is showing, the first nav action returns to question view instead of moving.
    function go(delta) {
      if (state.reviewMode) {
        state.reviewMode = false;
        renderAll();
        return;
      }

      const k = clamp(state.index + delta, 0, exam.questions.length - 1);
      if (k === state.index) return; // already at the boundary; no-op

      commitQuestionTime();
      state.index = k;
      enterCurrentQuestion();
      renderAll();
      window.scrollTo(0, 0); // scroll back to top so users always see the question
    }

    // Toggle the "mark for review" flag on the current question.
    function toggleFlag() {
      if (state.reviewMode) return; // flag toggling is only relevant in question view
      const q = exam.questions[state.index];
      if (!q) return;
      state.flags[q.id] = !state.flags[q.id];
      renderProgress();
      buildPopGrid();
      buildCheckGrid();
      renderQuestion();
    }

    if (el.flagTop) el.flagTop.addEventListener("click", toggleFlag);

    // Wire up the elimination-mode toggle (also keyboard-shortcut bound below).
    if (el.elimToggle && el.elimHint) {
      el.elimToggle.addEventListener("click", () => {
        state.eliminateMode = !state.eliminateMode;
        el.elimToggle.classList.toggle("on", state.eliminateMode);
        el.elimToggle.setAttribute("aria-pressed", String(state.eliminateMode));
        el.elimHint.hidden = !state.eliminateMode;
      });
    }

    if (el.back) el.back.addEventListener("click", () => go(-1));
    if (el.next) el.next.addEventListener("click", () => go(1));

    // Global keyboard shortcuts: arrow keys to navigate, F to flag, E to toggle elim mode.
    document.addEventListener("keydown", (e) => {
      if (state.finished) return;
      // Don't hijack typing in inputs/textareas/selects.
      const tag = ((e.target && e.target.tagName) || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFlag();
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        if (el.elimToggle && el.elimHint) {
          state.eliminateMode = !state.eliminateMode;
          el.elimToggle.classList.toggle("on", state.eliminateMode);
          el.elimToggle.setAttribute("aria-pressed", String(state.eliminateMode));
          el.elimHint.hidden = !state.eliminateMode;
        }
      }
    });

    // -----------------------
    // Popover navigator
    // -----------------------

    // Show the floating navigator popover.
    function openPopover() {
      if (!el.pop || !el.pill) return;
      el.pop.style.display = "block";
      el.pill.setAttribute("aria-expanded", "true");
    }

    // Hide the floating navigator popover.
    function closePopover() {
      if (!el.pop || !el.pill) return;
      el.pop.style.display = "none";
      el.pill.setAttribute("aria-expanded", "false");
    }

    // Clicking the pill toggles the popover open/closed.
    if (el.pill && el.pop) {
      el.pill.addEventListener("click", () => {
        if (el.pop.style.display === "block") closePopover();
        else openPopover();
      });
    }

    if (el.popClose) el.popClose.addEventListener("click", closePopover);

    // "Go to review" button: switch to review page and close the popover.
    if (el.goReview) {
      el.goReview.addEventListener("click", () => {
        commitQuestionTime();
        state.reviewMode = true;
        closePopover();
        renderAll();
        window.scrollTo(0, 0);
      });
    }

    // Click-outside-to-close behavior for the popover.
    document.addEventListener("click", (e) => {
      if (!el.pop || !el.pill) return;
      const inside =
        e.target === el.pill ||
        el.pill.contains(e.target) ||
        e.target === el.pop ||
        el.pop.contains(e.target);
      if (!inside) closePopover();
    });

    // -----------------------
    // Focus / blur tracking
    // -----------------------

    // When the window loses focus (user switches tabs/apps), record diagnostics and optionally pause.
    function handleWindowBlur() {
      if (state.finished) return;
      state.blurCount += 1;
      state.tabSwitchCount += 1;
      state.isFocused = false;
      state.lastBlurAt = Date.now();
      if (exam.pauseOnBlur) stopTimer(); // proctoring option: pause when user looks away
    }

    // When the window regains focus, record diagnostics and resume the timer if appropriate.
    function handleWindowFocus() {
      if (state.finished) return;
      state.focusCount += 1;
      state.isFocused = true;
      state.lastFocusAt = Date.now();
      if (exam.pauseOnBlur && state.remaining > 0 && !state.timerId) startTimer();
    }

    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);

    // Clean up draft data when the user navigates away from the page.
    window.addEventListener("beforeunload", () => {
      safeRemoveStorage(draftKey);
      if (window.quizData && typeof window.quizData.clearSessionProgress === "function") {
        try {
          window.quizData.clearSessionProgress(exam.sectionId).catch(() => {});
        } catch {}
      }
    });

    // -----------------------
    // Finish + save + redirect
    // -----------------------

    // Best-effort attempt to read the current Firebase Auth UID without throwing.
    // Used for diagnostic logging — never blocks the save flow.
    async function getAuthUidBestEffort() {
      try {
        const mod = await import("/assets/js/firebase-init.js");
        await mod.authReady; // wait until auth state is settled
        return mod.auth?.currentUser?.uid || null;
      } catch {
        return null;
      }
    }

    // Returns `v` unless it's strictly undefined, in which case returns the fallback.
    // Useful because Firestore rejects undefined but accepts null.
    function coalesceDefined(v, fallback) {
      return v === undefined ? fallback : v;
    }

    // Normalizes a value into either an array, null, or undefined — never anything else.
    // Helps keep payloads Firestore-friendly.
    function normalizeArrayOrNull(v) {
      if (v === undefined) return undefined;
      if (v === null) return null;
      if (Array.isArray(v)) return v;
      return [v]; // wrap single non-array value in an array
    }

    // Wraps up the attempt: stops the timer, builds a clean items array, and (presumably)
    // hands off to saveAttempt() — but the script is cut off before this function completes.
    async function finishExam() {
      if (state.finished) return; // guard against double-finish
      state.finished = true;

      stopTimer();
      closePopover();
      commitQuestionTime(); // capture time on the final question

      const items = exam.questions.map((q, i) => {
        const chosen = typeof state.answers[q.id] === "number" ? state.answers[q.id] : null;

        // Avoid passing undefined arrays/objects into writer (common Firestore invalid-argument trigger
        // when something later serializes poorly). attempt-writer sanitizes too, but we keep engine tidy.
        const steps = normalizeArrayOrNull(q.steps);
               // Only keep `solution` if it's a real object — otherwise leave it undefined so we can drop it cleanly.
        const solution = q.solution && typeof q.solution === "object" ? q.solution : undefined;

        // Return one normalized "item" record per question for the saved attempt payload.
        return {
          number: i + 1, // 1-based question number for display

          questionId: q.questionId || q.id, // canonical ID
          id: q.id, // duplicate for backward compatibility
          version: q.version || 1, // schema version of this question

          topic: q.topic || null, // metadata: high-level topic
          skill: q.skill || null, // metadata: specific skill
          difficulty: coalesceDefined(q.difficulty, null), // null instead of undefined for Firestore safety

          // Save whichever prompt format we have — HTML if present, otherwise plain text.
          prompt: q.promptHtml ? q.promptHtml : q.promptText,
          promptIsHtml: !!q.promptHtml, // explicit flag tells the review page how to render it

          choices: Array.isArray(q.choices) ? q.choices : [], // always an array
          correctIndex: q.answerIndex, // which choice index is correct
          chosenIndex: chosen, // which choice the user picked (or null)
          correct: chosen !== null && chosen === q.answerIndex, // boolean: did the user get it right?

          explanation: String(q.explanation || ""), // always a string, even if empty
          steps, // can be undefined, array, or null
          solution, // optional object; undefined if there wasn't one

          timeSpentSec: Number(state.questionTimes[q.id] || 0), // accumulated time on this question
          visits: Number(state.visits[q.id] || 0), // how many times the user landed on it
        };
      });

      // Tally everything for the summary section of the attempt.
      const answeredCount = items.filter((it) => it.chosenIndex !== null).length; // questions the user attempted
      const correctCount = items.filter((it) => it.correct).length; // questions they got right
      const totalCount = items.length; // total questions in this attempt
      const elapsedSec = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000)); // total wall-clock duration

      // Group all summary stats into a single tidy object.
      const totals = {
        answered: answeredCount,
        correct: correctCount,
        total: totalCount,
        timeSpentSec: elapsedSec,
        scorePercent: totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0, // guard against divide-by-zero
      };

      const attemptId = state.attemptId || createAttemptId(); // reuse the existing ID (preferred) or generate one
      // Coerce attemptType to either "random" or "topic" — anything else falls back to "topic".
      const attemptType = String(exam.attemptType || "topic").toLowerCase() === "random" ? "random" : "topic";

      // Assemble the full attempt payload that will be saved to Firestore + localStorage.
      const attempt = {
        attemptId,
        attemptType,

        quizId: exam.quizId, // the quiz the user took
        sectionId: exam.sectionId, // section identifier (often equal to quizId)
        title: exam.sectionTitle || exam.title || null, // human-readable title

        // Snapshot of bank metadata at the time of this attempt — useful for analytics later.
        bank: {
          bankId: exam.bankId || null,
          bankVersion: exam.bankVersion ?? null, // ?? preserves 0 instead of falling through
          title: exam.bankTitle || (exam.sectionTitle || exam.title) || null,
          description: exam.bankDescription || null,
          skills: Array.isArray(exam.bankSkills) ? exam.bankSkills : null,
        },

        // Random metadata (optional but important for diagnosing "random attempts not saving")
        // Only attached when this was a random-pick attempt; otherwise null to keep the payload small.
        pick: attemptType === "random" ? (exam.pickMeta || null) : null,

        generatedAt: new Date().toISOString(), // ISO timestamp for sorting/display
        totals, // summary numbers from above
        items, // detailed per-question records

        // Snapshot of UI state at finish — lets the review page render with the same toggles.
        uiState: {
          timerHidden: state.timerHidden,
          reviewMode: state.reviewMode,
          lastQuestionIndex: state.index,
        },
        // Engagement diagnostics — useful for proctoring or analytics dashboards.
        sessionMeta: {
          blurCount: state.blurCount,
          focusCount: state.focusCount,
          tabSwitchCount: state.tabSwitchCount,
          questionTimes: state.questionTimes,
          visits: state.visits,
        },
      };

      const reviewUrl = resolveReviewUrl(attemptId); // pre-compute where to redirect on success

      // Wraps the saveAttempt() call so we can reuse it for both the initial save and any retries.
      // Returns { ok, res } — never throws. On success, redirects to the review page.
      const doSave = async () => {
        const res = await saveAttempt(attempt); // hands off to the imported writer module
        console.log("[quiz-engine] saveAttempt result:", res); // always log so devs can inspect via DevTools

        if (res && res.ok) {
          removeSaveBanner(); // clear any prior failure banner — we succeeded!

          // Clean up any in-progress drafts since the attempt is now safely saved.
          safeRemoveStorage(draftKey);
          if (window.quizData && typeof window.quizData.clearSessionProgress === "function") {
            try {
              window.quizData.clearSessionProgress(exam.sectionId).catch(() => {});
            } catch {}
          }

          window.location.href = reviewUrl; // navigate to the review page
          return { ok: true, res };
        }
        return { ok: false, res }; // signal failure but don't throw
      };

      const first = await doSave(); // first save attempt
      if (first.ok) return; // happy path: nothing else to do

      // Build a high-signal error message for the banner
      // Below this line is the "save failed" diagnostic flow — it tells the user what happened
      // and gives developers enough info in the banner to debug without opening DevTools.

      const uid = await getAuthUidBestEffort(); // try to grab the current user ID for diagnostics
      const r = first.res || {}; // safe alias for the failure response
      const code = r.code || "unknown"; // Firebase-style error code if present
      const msg = r.message || "Cloud save failed."; // human-readable message
      const path = r.path ? `path=${r.path}` : ""; // which Firestore path failed (if reported)
      // Did the writer at least manage to save locally? Important context for the user.
      const localSaved = r.localSaved === true ? "localSaved=true" : (r.localSaved === false ? "localSaved=false" : "");
      const authLine = uid ? `auth.uid=${uid}` : "auth.uid=null"; // explicit auth state

      // Join everything into a multi-line details block, dropping any empty lines.
      const details = [authLine, `attemptId=${attemptId}`, `code=${code}`, path, localSaved].filter(Boolean).join("\n");

      // Show the failure banner with a Retry button wired up to call doSave() again.
      showSaveBanner({
        title: "Couldn't save your attempt to the cloud",
        message: `${msg} (Your attempt is still saved locally.)`,
        details,
        onRetry: async () => {
          const again = await doSave(); // second attempt
          if (!again.ok) {
            // Build fresh diagnostics for the second failure (state may have changed).
            const uid2 = await getAuthUidBestEffort();
            const r2 = again.res || {};
            const details2 = [
              uid2 ? `auth.uid=${uid2}` : "auth.uid=null",
              `attemptId=${attemptId}`,
              `code=${r2.code || "unknown"}`,
              r2.path ? `path=${r2.path}` : "",
              r2.localSaved === true ? "localSaved=true" : (r2.localSaved === false ? "localSaved=false" : ""),
            ]
              .filter(Boolean)
              .join("\n");

            // Replace the banner with an updated one (showSaveBanner removes the old one first).
            showSaveBanner({
              title: "Save retry failed",
              message: `${r2.message || "Cloud save retry failed."} (Your attempt is still saved locally.)`,
              details: details2,
              onRetry: async () => {
                // allow repeated retries without stacking banners
                const third = await doSave(); // third attempt
                if (!third.ok) {
                  // keep banner; console already has payload
                  // (Intentionally silent — the existing banner stays visible and the console has full details.)
                }
              },
            });
          }
        },
      });
    }

    // Wire the Finish button to the finishExam flow.
    if (el.finish) el.finish.addEventListener("click", finishExam);

    // -----------------------
    // Init render
    // -----------------------
    // Final boot sequence for the engine: build the visual scaffolding, render everything once,
    // mark the user as having entered the first question, and start the countdown timer.
    buildTicks();
    buildProgressSkeleton(exam.questions.length);
    renderAll();
    enterCurrentQuestion();
    startTimer();
  }

  // -----------------------
  // 7) Boot: resolve quizId -> registry -> bank -> pick -> run
  // -----------------------

  // Top-level orchestrator: figures out which quiz to run, loads it, and hands off to runEngine.
  // Two paths:
  //   1) A page already provided window.dsaQuizConfig with inline questions (legacy/topic mode).
  //   2) Resolve quizId → look up registry entry → fetch JSON bank → pick questions.
  async function boot() {
    // If some page already set window.dsaQuizConfig, use it (topic-style)
    // This is the "page already prepared everything" shortcut path.
    if (window.dsaQuizConfig && Array.isArray(window.dsaQuizConfig.questions)) {
      const cfg = window.dsaQuizConfig;
      const norm = normalizeQuestions(cfg.questions); // standardize question shape
      const err = validateQuestions(norm); // validate before running
      if (err) return void showFatal(err); // `void` discards the showFatal return value to keep the arrow concise

      // Build the exam object directly from the inline config and start the engine.
      runEngine({
        attemptId: cfg.attemptId,
        // Coerce attemptType to "random" or "topic" with "topic" as a safe default.
        attemptType: String(cfg.attemptType || "topic").toLowerCase() === "random" ? "random" : "topic",

        // Allow either field name for quiz/section identity.
        quizId: cfg.quizId || cfg.sectionId,
        sectionId: cfg.sectionId || cfg.quizId,

        // Same flexibility for titles.
        title: cfg.title || cfg.sectionTitle,
        sectionTitle: cfg.sectionTitle || cfg.title,

        // Bank metadata fields (all optional).
        bankId: cfg.bankId || null,
        bankVersion: cfg.bankVersion || null,
        bankTitle: cfg.bankTitle || null,
        bankDescription: cfg.bankDescription || null,
        bankSkills: cfg.bankSkills || null,

        timeLimitSec: cfg.timeLimitSec || 0, // 0 = no timer
        pauseOnBlur: !!cfg.pauseOnBlur, // proctoring option
        questions: norm,
      });
      return; // we're done — don't fall through to the registry path
    }

    // Otherwise: use the registry-driven path.
    const registry = getRegistry();
    if (!registry) {
      showFatal("Quiz registry not found. Ensure /assets/js/quiz-registry.js defines window.QUIZ_REGISTRY.");
      return;
    }

    const quizId = resolveQuizId(registry); // try URL → hash → path → localStorage → default
    if (!quizId) {
      showFatal("Could not resolve quizId. Use ?quizId=... or ensure registry is populated.");
      return;
    }

    setLastQuizId(quizId); // remember this quiz for next time

    const cfg = registry[quizId]; // look up its config object
    if (!cfg) {
      // escapeHtml prevents any weird characters in quizId from breaking the error UI.
      showFatal(`Unknown quizId: ${escapeHtml(quizId)} (no entry found in window.QUIZ_REGISTRY).`);
      return;
    }

    cfg.__quizId = quizId; // attach the ID onto the config so pickQuestionsFromBank can use it for "perQuiz" seeding

    // Each registry entry should point to a JSON bank URL — accept several field names for compatibility.
    const bankUrl = cfg.bankUrl || cfg.jsonUrl || cfg.url;
    if (!bankUrl) {
      showFatal(`Quiz ${escapeHtml(quizId)} exists in registry but is missing bankUrl.`);
      return;
    }

    const bank = await loadJson(bankUrl); // fetch the question bank from disk/network

    // Determine attempt type
    const attemptType = resolveAttemptType(cfg, bank); // "topic" or "random"

    // Build questions (random pick if configured; otherwise use full bank order)
    const attemptId = createAttemptId(); // generate the attempt ID up front so it can seed the random picker
    // Random mode: pick N questions using the seeded shuffler. Topic mode: use the bank as-is.
    const pickedRaw = attemptType === "random" ? pickQuestionsFromBank(bank, cfg, attemptId) : bank.questions || [];
    const questions = normalizeQuestions(pickedRaw); // standardize shape

    const err = validateQuestions(questions); // validate before running
    if (err) return void showFatal(err);

    // Resolve display strings + timer with sensible fallbacks.
    const title = cfg.title || bank.title || quizId;
    const sectionTitle = cfg.sectionTitle || title;
    const timeLimitSec = Number(cfg.timeLimitSec || cfg.timerSec || cfg.timeLimit || 0) || 0;

    // Random pick metadata for persistence/debugging
    // Builds a record of HOW the random selection happened so we can debug "wrong questions appeared" later.
    const pickMeta =
      attemptType === "random"
        ? {
            pickCount: Number(cfg.pickCount || cfg.count || 0) || questions.length, // how many were requested
            seedMode: cfg.seedMode || null, // "perAttempt", "perQuiz", or null
            // The exact seed value that drove the shuffle — critical for reproducing a specific random pick.
            seedValue:
              cfg.seedMode === "perAttempt"
                ? String(attemptId)
                : cfg.seedMode === "perQuiz"
                  ? String(quizId)
                  : null,
            // Snapshot of which questions ended up selected (just IDs + versions, not the full data).
            picked: questions.map((q) => ({
              questionId: q.questionId || q.id,
              version: q.version || 1,
            })),
          }
        : null; // not random → no pick metadata needed

    // Final hand-off to the engine with the fully assembled exam config.
    runEngine({
      attemptId,
      attemptType,

      quizId: quizId,
      sectionId: quizId, // sectionId mirrors quizId in the registry-driven path
      title,
      sectionTitle,
      timeLimitSec,
      pauseOnBlur: !!cfg.pauseOnBlur,
      questions,

      // Bank metadata for analytics / review-page display.
      bankId: bank.bankId || null,
      bankVersion: bank.bankVersion ?? null,
      bankTitle: bank.title || null,
      bankDescription: bank.description || null,
      bankSkills: Array.isArray(bank.skills) ? bank.skills : null,

      pickMeta, // null for topic attempts, populated object for random attempts
    });
  }

  // Boot dispatcher: handles the case where the script loads before vs after the DOM is ready.
  // Either way, boot() runs exactly once, with errors surfaced via showFatal.
  if (document.readyState === "loading") {
    // Document still parsing → wait for DOMContentLoaded before booting.
    document.addEventListener("DOMContentLoaded", () => {
      boot().catch((err) => showFatal(err?.message ? String(err.message) : "Quiz init failed"));
    });
  } else {
    // Document already parsed (script was loaded with `defer`, or injected late) → boot immediately.
    boot().catch((err) => showFatal(err?.message ? String(err.message) : "Quiz init failed"));
  }
})(); // end of the IIFE — everything above this line runs in a private scope
