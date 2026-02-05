// /assets/js/quiz-engine.js
// Unified quiz engine:
// - Loads quiz metadata + question bank (via ?quizId=... registry)
// - Renders Bluebook-style UI (expects the same IDs you already use)
// - Handles timer, flags, elimination mode, popover navigator, "Check Your Work"
// - Records per-question time + visits + focus/blur counts
// - On finish: writes attempt summary to localStorage (dsa:attempt:{attemptId})
//              and (if available) to Firestore via window.quizData.appendAttempt()
// - CRITICAL REQUIREMENT:
//   ALWAYS START FRESH. If user returns to the page without finishing,
//   the engine clears any draft/session state and does NOT resume.

import { routes } from "/assets/js/lib/routes.js";

(function () {
  "use strict";

  // -----------------------
  // 0) Quiz registry (move this into /assets/quizzes/quizzes.json later if desired)
  // -----------------------
  const QUIZ_REGISTRY = {
    "math.circles.practice": {
      quizId: "math.circles.practice",
      title: "Circles (Practice)",
      sectionTitle: "Section 1, Module 1: Math — Circles (Practice)",
      timeLimitSec: 14 * 60,
      bank: "/assets/question-bank/math/circles.json",
      pauseOnBlur: false
    }
    // Add more here:
    // "math.linear_functions.practice": { ... bank: "/assets/question-bank/math/linear-functions.json", timeLimitSec: 14*60 }
  };

  function getQuizIdFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      return params.get("quizId");
    } catch {
      return null;
    }
  }

  async function loadJson(url) {
    const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
    return res.json();
  }

  function pickQuestions(bank /*, meta */) {
    // For now: use all questions in the bank
    if (!bank || !Array.isArray(bank.questions)) return [];
    return bank.questions;
  }

  // -----------------------
  // 1) Key helpers (Step 6 keys)
  // -----------------------
  function createAttemptId() {
    return "t_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  }

  function getDraftKey(quizId) {
    return `dsa:draft:${quizId}`;
  }

  function getAttemptKey(attemptId) {
    return `dsa:attempt:${attemptId}`;
  }

  function safeRemoveStorage(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function safeSetStorage(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  // -----------------------
  // 2) DOM cache
  // -----------------------
  const el = {
    sectionTitle: document.getElementById("sectionTitle"),
    timeLeft: document.getElementById("timeLeft"),
    toggleTimer: document.getElementById("toggleTimer"),

    qcard: document.getElementById("qcard"),
    qbadge: document.getElementById("qbadge"),
    qtitle: document.getElementById("qtitle"),
    choices: document.getElementById("choices"),
    flagTop: document.getElementById("flagTop"),
    flagLabel: document.getElementById("flagLabel"),
    elimToggle: document.getElementById("elimToggle"),
    elimHint: document.getElementById("elimHint"),

    back: document.getElementById("btnBack"),
    next: document.getElementById("btnNext"),
    finish: document.getElementById("btnFinish"),

    progress: document.getElementById("progress"),
    pill: document.getElementById("centerPill"),
    pillText: document.getElementById("pillText"),
    pillFlag: document.getElementById("pillFlag"),

    pop: document.getElementById("popover"),
    popGrid: document.getElementById("popGrid"),
    popClose: document.getElementById("popClose"),
    goReview: document.getElementById("goReview"),

    checkPage: document.getElementById("checkPage"),
    checkGrid: document.getElementById("checkGrid"),

    dashrow: document.getElementById("dashrow"),

    popTitle: document.getElementById("popTitle"),     // optional
    checkTitle: document.getElementById("checkTitle"), // optional
    practiceBanner: document.getElementById("practiceBanner") // optional
  };

  function showFatal(message) {
    console.error("[quiz-engine] " + message);
    const box = document.createElement("div");
    box.style.cssText =
      "max-width:980px;margin:14px auto;padding:12px 14px;background:#fff;border:1px solid #c00;border-radius:10px;" +
      "font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:#111;";
    box.innerHTML = `<h2 style="margin:0 0 6px;font-size:18px">Quiz failed to load</h2><p style="margin:0">${message}</p>`;
    document.body.prepend(box);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // -----------------------
  // 3) Build ticks / progress skeletons (UI)
  // -----------------------
  function buildTicks() {
    if (!el.dashrow) return;
    el.dashrow.innerHTML = "";
    for (let i = 0; i < 54; i++) {
      const d = document.createElement("div");
      d.className = "dash";
      el.dashrow.appendChild(d);
    }
  }

  function buildProgressSkeleton(questionCount) {
    if (!el.progress) return;
    const seg = Math.max(24, questionCount * 2);
    el.progress.style.setProperty("--seg", seg);
    el.progress.innerHTML = "";
    for (let i = 0; i < seg; i++) {
      const s = document.createElement("div");
      s.className = "seg";
      el.progress.appendChild(s);
    }
  }

  // -----------------------
  // 4) Core engine (runs after config+bank are loaded)
  // -----------------------
  function runEngine(exam) {
    if (!exam || !Array.isArray(exam.questions) || exam.questions.length === 0) {
      showFatal("No questions found for this quiz.");
      return;
    }

    const quizIdForKeys = String(exam.quizId || exam.sectionId || "unknown-quiz");
    const draftKey = getDraftKey(quizIdForKeys);

    // CRITICAL: Always start fresh. Clear any draft/session on entry.
    safeRemoveStorage(draftKey);
    if (window.quizData && typeof window.quizData.clearSessionProgress === "function") {
      try { window.quizData.clearSessionProgress(exam.sectionId).catch(() => {}); } catch {}
    }

    // -----------------------
    // State
    // -----------------------
    const state = {
      index: 0,
      answers: {}, // { qid: choiceIndex }
      flags: {},   // { qid: true/false }
      elims: {},   // { qid: Set(choiceIndex) }
      eliminateMode: false,

      remaining: exam.timeLimitSec || 0,
      timerId: null,
      timerHidden: false,
      finished: false,
      reviewMode: false,

      startedAt: Date.now(),
      attemptId: createAttemptId(),

      // Per-question timing
      currentQuestionEnterTs: null,
      questionTimes: {}, // { qid: totalSeconds }
      visits: {},        // { qid: count }

      // Focus / tab tracking
      blurCount: 0,
      focusCount: document.hasFocus() ? 1 : 0,
      tabSwitchCount: 0,
      lastBlurAt: null,
      lastFocusAt: document.hasFocus() ? Date.now() : null,
      isFocused: document.hasFocus()
    };

    // -----------------------
    // Timer
    // -----------------------
    function updateTimeDisplay() {
      if (!el.timeLeft) return;
      const m = String(Math.floor(state.remaining / 60)).padStart(2, "0");
      const s = String(state.remaining % 60).padStart(2, "0");
      if (!state.timerHidden) {
        el.timeLeft.textContent = `${m}:${s}`;
        el.timeLeft.style.visibility = "visible";
      } else {
        el.timeLeft.style.visibility = "hidden";
      }
    }

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

    function startTimer() {
      if (state.timerId || state.finished || !state.remaining) return;
      updateTimeDisplay();
      state.timerId = setInterval(tick, 1000);
    }

    function stopTimer() {
      if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
      }
    }

    if (el.toggleTimer && el.timeLeft) {
      el.toggleTimer.addEventListener("click", () => {
        state.timerHidden = !state.timerHidden;
        el.toggleTimer.textContent = state.timerHidden ? "Show" : "Hide";
        updateTimeDisplay();
      });
    }

    // -----------------------
    // View mode (question vs "Check Your Work")
    // -----------------------
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
    function commitQuestionTime() {
      const q = exam.questions[state.index];
      if (!q || !state.currentQuestionEnterTs) return;
      const now = Date.now();
      const deltaSec = Math.max(0, Math.round((now - state.currentQuestionEnterTs) / 1000));
      const prev = state.questionTimes[q.id] || 0;
      state.questionTimes[q.id] = prev + deltaSec;
      state.currentQuestionEnterTs = now;
    }

    function enterCurrentQuestion() {
      const q = exam.questions[state.index];
      state.currentQuestionEnterTs = Date.now();
      if (!q) return;
      state.visits[q.id] = (state.visits[q.id] || 0) + 1;
    }

    // -----------------------
    // Rendering
    // -----------------------
    function updateTitles() {
      const title = exam.sectionTitle || exam.title || "";
      if (el.sectionTitle) el.sectionTitle.textContent = title;
      if (el.popTitle) el.popTitle.textContent = title ? `${title} Questions` : "Questions";
      if (el.checkTitle) el.checkTitle.textContent = title ? `${title} Questions` : "Questions";
      document.title = title || document.title;
    }

    function letter(i) {
      return String.fromCharCode(65 + i);
    }

    function toggleElimination(qid, idx) {
      if (!state.elims[qid]) state.elims[qid] = new Set();
      const s = state.elims[qid];
      if (s.has(idx)) s.delete(idx);
      else s.add(idx);
    }

    function renderQuestion() {
      const q = exam.questions[state.index];
      if (!q) return;

      if (el.qbadge) el.qbadge.textContent = String(state.index + 1);
      if (el.qtitle) el.qtitle.innerHTML = q.prompt;

      const elimSet = state.elims[q.id] || new Set();

      if (el.choices) {
        el.choices.innerHTML = q.choices
          .map((t, i) => {
            const id = `${q.id}_c${i}`;
            const checked = state.answers[q.id] === i ? "checked" : "";
            const elimClass = elimSet.has(i) ? "eliminated" : "";
            return `
              <label class="choice ${elimClass}" data-choice="${i}" for="${id}">
                <input id="${id}" type="radio" name="${q.id}" value="${i}" ${checked} />
                <div class="text"><b>${letter(i)}.</b> ${t}</div>
                <div class="letter">${letter(i)}</div>
              </label>
            `;
          })
          .join("");

        // Bind events
        el.choices.querySelectorAll(".choice").forEach((choice) => {
          const idx = Number(choice.dataset.choice);
          const input = choice.querySelector("input");

          choice.addEventListener("click", (ev) => {
            if (!state.eliminateMode) return;
            if (ev.target && ev.target.tagName && ev.target.tagName.toLowerCase() === "input") return;
            ev.preventDefault();
            toggleElimination(q.id, idx);
            choice.classList.toggle("eliminated");
          });

          input.addEventListener("change", () => {
            state.answers[q.id] = idx;
            renderProgress();
            buildPopGrid();
            buildCheckGrid();
          });
        });
      }

      // Flag visual
      const flagged = !!state.flags[q.id];
      if (el.flagTop && el.flagLabel) {
        el.flagTop.classList.toggle("on", flagged);
        el.flagTop.setAttribute("aria-pressed", String(flagged));
        el.flagLabel.textContent = flagged ? "For review" : "Mark for review";
      }

      // Eliminate visual
      if (el.elimToggle && el.elimHint) {
        el.elimToggle.classList.toggle("on", state.eliminateMode);
        el.elimToggle.setAttribute("aria-pressed", String(state.eliminateMode));
        el.elimHint.style.display = state.eliminateMode ? "block" : "none";
      }

      // MathJax (optional)
      if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([el.qtitle, el.choices]).catch(() => {});
      }
    }

    function renderProgress() {
      if (!el.progress) return;
      const segs = el.progress.children.length;
      const active = Math.ceil(((state.index + 1) / exam.questions.length) * segs);
      for (let i = 0; i < segs; i++) {
        el.progress.children[i].classList.toggle("active", i < active);
      }
      if (el.pillText) el.pillText.textContent = `Question ${state.index + 1} of ${exam.questions.length}`;
      updatePillFlag();
      updateNavs();
    }

    function updatePillFlag() {
      const q = exam.questions[state.index];
      if (!q || !el.pillFlag) return;
      const flagged = !!state.flags[q.id];
      el.pillFlag.style.display = flagged ? "block" : "none";
    }

    function updateNavs() {
      if (!el.next || !el.finish) return;
      const last = state.index === exam.questions.length - 1 && !state.reviewMode;
      el.next.style.display = last ? "none" : "inline-block";
      el.finish.style.display = last ? "inline-block" : "none";
    }

    function buildPopGrid() {
      if (!el.popGrid) return;
      el.popGrid.innerHTML = "";

      exam.questions.forEach((q, i) => {
        const b = document.createElement("button");
        b.className = "nbtn";
        b.textContent = String(i + 1);

        const answered = typeof state.answers[q.id] === "number";
        const flagged = !!state.flags[q.id];

        if (i === state.index) {
          b.classList.add("current");
          const pin = document.createElement("span");
          pin.className = "pin";
          pin.textContent = "📍";
          b.appendChild(pin);
        }
        if (answered) b.classList.add("answered");
        if (flagged) b.classList.add("review");

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
    function go(delta) {
      if (state.reviewMode) {
        state.reviewMode = false;
        renderAll();
        return;
      }

      const k = clamp(state.index + delta, 0, exam.questions.length - 1);
      if (k === state.index) return;

      commitQuestionTime();
      state.index = k;
      enterCurrentQuestion();
      renderAll();
      window.scrollTo(0, 0);
    }

    function toggleFlag() {
      if (state.reviewMode) return;
      const q = exam.questions[state.index];
      if (!q) return;
      state.flags[q.id] = !state.flags[q.id];
      renderProgress();
      buildPopGrid();
      buildCheckGrid();
      renderQuestion();
    }

    if (el.flagTop) el.flagTop.addEventListener("click", toggleFlag);

    if (el.elimToggle && el.elimHint) {
      el.elimToggle.addEventListener("click", () => {
        state.eliminateMode = !state.eliminateMode;
        el.elimToggle.classList.toggle("on", state.eliminateMode);
        el.elimToggle.setAttribute("aria-pressed", String(state.eliminateMode));
        el.elimHint.style.display = state.eliminateMode ? "block" : "none";
      });
    }

    if (el.back) el.back.addEventListener("click", () => go(-1));
    if (el.next) el.next.addEventListener("click", () => go(1));

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (state.finished) return;
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
          el.elimHint.style.display = state.eliminateMode ? "block" : "none";
        }
      }
    });

    // -----------------------
    // Popover navigator
    // -----------------------
    function openPopover() {
      if (!el.pop || !el.pill) return;
      el.pop.style.display = "block";
      el.pill.setAttribute("aria-expanded", "true");
    }

    function closePopover() {
      if (!el.pop || !el.pill) return;
      el.pop.style.display = "none";
      el.pill.setAttribute("aria-expanded", "false");
    }

    if (el.pill && el.pop) {
      el.pill.addEventListener("click", () => {
        if (el.pop.style.display === "block") closePopover();
        else openPopover();
      });
    }

    if (el.popClose) el.popClose.addEventListener("click", closePopover);

    if (el.goReview) {
      el.goReview.addEventListener("click", () => {
        commitQuestionTime();
        state.reviewMode = true;
        closePopover();
        renderAll();
        window.scrollTo(0, 0);
      });
    }

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
    function handleWindowBlur() {
      if (state.finished) return;
      state.blurCount += 1;
      state.tabSwitchCount += 1;
      state.isFocused = false;
      state.lastBlurAt = Date.now();
      if (exam.pauseOnBlur) stopTimer();
    }

    function handleWindowFocus() {
      if (state.finished) return;
      state.focusCount += 1;
      state.isFocused = true;
      state.lastFocusAt = Date.now();
      if (exam.pauseOnBlur && state.remaining > 0 && !state.timerId) startTimer();
    }

    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);

    // -----------------------
    // Leave-page behavior: CLEAR ALL DATA (no resume)
    // -----------------------
    window.addEventListener("beforeunload", () => {
      // We intentionally do NOT preserve draft state for resuming.
      safeRemoveStorage(draftKey);
      if (window.quizData && typeof window.quizData.clearSessionProgress === "function") {
        try { window.quizData.clearSessionProgress(exam.sectionId).catch(() => {}); } catch {}
      }
    });

    // -----------------------
    // Finish + redirect to single review.html?attemptId=...
    // -----------------------
    function finishExam() {
      if (state.finished) return;
      state.finished = true;

      stopTimer();
      closePopover();
      commitQuestionTime();

      const items = exam.questions.map((q, i) => {
        const chosen = typeof state.answers[q.id] === "number" ? state.answers[q.id] : null;
        return {
          number: i + 1,
          questionId: q.questionId || q.id,
          version: q.version || 1,
          id: q.id,
          prompt: q.prompt,
          choices: q.choices,
          correctIndex: q.answerIndex,
          chosenIndex: chosen,
          correct: chosen === q.answerIndex,
          explanation: q.explanation || "",
          steps: Array.isArray(q.steps) ? q.steps : undefined,
          timeSpentSec: state.questionTimes[q.id] || 0,
          visits: state.visits[q.id] || 0
        };
      });

      const answeredCount = items.filter((it) => it.chosenIndex !== null).length;
      const correctCount = items.filter((it) => it.correct).length;
      const totalCount = items.length;

      const elapsedSec = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));

      const totals = {
        answered: answeredCount,
        correct: correctCount,
        total: totalCount,
        timeSpentSec: elapsedSec,
        scorePercent: totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0
      };

      const attemptId = state.attemptId || createAttemptId();

      const summary = {
        attemptId,
        quizId: quizIdForKeys,
        sectionId: exam.sectionId,
        title: exam.sectionTitle || exam.title,
        generatedAt: new Date().toISOString(),
        totals,
        items,
        uiState: {
          timerHidden: state.timerHidden,
          reviewMode: state.reviewMode,
          lastQuestionIndex: state.index
        },
        sessionMeta: {
          blurCount: state.blurCount,
          focusCount: state.focusCount,
          tabSwitchCount: state.tabSwitchCount,
          questionTimes: state.questionTimes,
          visits: state.visits
        }
      };

      const reviewUrl = routes.review(attemptId);

      function finalizeAndRedirect() {
        // Clear any draft (always)
        safeRemoveStorage(draftKey);

        // Store attempt for review page
        safeSetStorage(getAttemptKey(attemptId), JSON.stringify(summary));

        // Best-effort: clear Firestore session progress
        if (window.quizData && typeof window.quizData.clearSessionProgress === "function") {
          try { window.quizData.clearSessionProgress(exam.sectionId).catch(() => {}); } catch {}
        }

        window.location.href = reviewUrl;
      }

      // Save to Firestore FIRST if available, then redirect
      if (window.quizData && typeof window.quizData.appendAttempt === "function") {
        window.quizData
          .appendAttempt(summary)
          .catch((err) => console.error("quiz-engine: failed to save attempt to Firestore", err))
          .finally(() => finalizeAndRedirect());
      } else {
        finalizeAndRedirect();
      }
    }

    if (el.finish) el.finish.addEventListener("click", finishExam);

    // -----------------------
    // Init render
    // -----------------------
    buildTicks();
    buildProgressSkeleton(exam.questions.length);
    renderAll();
    enterCurrentQuestion();
    startTimer();
  }

  // -----------------------
  // 5) Boot: load quiz config + question bank, then run
  // -----------------------
  async function boot() {
    // If some page already set window.dsaQuizConfig, use it.
    // Otherwise: resolve quizId -> registry -> bank.
    if (window.dsaQuizConfig && Array.isArray(window.dsaQuizConfig.questions)) {
      const cfg = window.dsaQuizConfig;
      runEngine({
        quizId: cfg.quizId || cfg.sectionId,
        sectionId: cfg.sectionId || cfg.quizId,
        title: cfg.title || cfg.sectionTitle,
        sectionTitle: cfg.sectionTitle || cfg.title,
        timeLimitSec: cfg.timeLimitSec || 0,
        pauseOnBlur: !!cfg.pauseOnBlur,
        questions: cfg.questions
      });
      return;
    }

    const quizId = getQuizIdFromUrl();
    if (!quizId) {
      showFatal("Missing required URL parameter: ?quizId=...");
      return;
    }

    const meta = QUIZ_REGISTRY[quizId];
    if (!meta) {
      showFatal(`Unknown quizId: ${quizId}`);
      return;
    }

    const bank = await loadJson(meta.bank);
    const questions = pickQuestions(bank, meta);

    runEngine({
      quizId: meta.quizId,
      sectionId: meta.quizId, // ok for now
      title: meta.title,
      sectionTitle: meta.sectionTitle,
      timeLimitSec: meta.timeLimitSec,
      pauseOnBlur: !!meta.pauseOnBlur,
      questions
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      boot().catch((err) => showFatal(err?.message ? String(err.message) : "Quiz init failed"));
    });
  } else {
    boot().catch((err) => showFatal(err?.message ? String(err.message) : "Quiz init failed"));
  }
})();
