(function () {
  const exam = window.examConfig;
  if (!exam) {
    console.error("quiz-engine.js: window.examConfig is missing.");
    return;
  }

  // -----------------------
  // Helpers
  // -----------------------
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // Simple attempt ID generator (used for local + Firestore records)
  function createAttemptId() {
    return "t_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  }

  const ATTEMPT_STORAGE_KEY = "dreamschool:attempts:v1";

  // Minimal local attempt history (recorder-style)
  function recordLocalAttempt(summary) {
    try {
      const raw = localStorage.getItem(ATTEMPT_STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];

      const totals = summary.totals || {};
      const score = totals.correct || 0;
      const total = totals.total || 0;
      const percent =
        total > 0 ? Math.round((score / total) * 10000) / 100 : 0;

      const record = {
        id: summary.attemptId || createAttemptId(),
        sectionId: summary.sectionId || exam.sectionId || null,
        title: summary.title || exam.sectionTitle || "",
        timestamp: summary.generatedAt || new Date().toISOString(),
        score,
        total,
        percent,
        durationSeconds: totals.timeSpentSec || 0
      };

      list.push(record);
      localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      // non-fatal; just a convenience history
      console.warn("quiz-engine: failed to record local attempt", e);
    }
  }

  // Build a lightweight progressState for quiz-data.js
  function buildProgressState(state) {
    const currentQ = exam.questions[state.index];
    const answers = {};

    Object.keys(state.answers).forEach((qid) => {
      const q = exam.questions.find((qq) => qq.id === qid);
      const chosenIndex = state.answers[qid];
      const correctIndex =
        q && typeof q.answerIndex === "number" ? q.answerIndex : null;
      const isCorrect =
        typeof chosenIndex === "number" &&
        typeof correctIndex === "number" &&
        chosenIndex === correctIndex;

      answers[qid] = {
        chosenIndex,
        correctIndex,
        isCorrect
      };
    });

    return {
      sectionId: exam.sectionId,
      title: exam.sectionTitle,
      lastQuestionId: currentQ ? currentQ.id : null,
      lastQuestionIndex: state.index,
      lastScreenIndex: 0,
      timerHidden: state.timerHidden,
      questionCountHidden: false,
      reviewMode: state.reviewMode,
      answers
    };
  }

  // -----------------------
  // State
  // -----------------------
  const state = {
    index: 0,
    answers: {}, // { qid: choiceIndex }
    flags: {}, // { qid: true/false }
    elims: {}, // { qid: Set(choiceIndex) }
    eliminateMode: false,
    remaining: exam.timeLimitSec || 0,
    timerId: null,
    timerHidden: false,
    finished: false,
    reviewMode: false,
    startedAt: null,
    attemptId: null,

    // Per-question timing
    currentQuestionEnterTs: null,
    questionTimes: {}, // { qid: totalSeconds }
    visits: {}, // { qid: count }

    // Focus / tab tracking
    blurCount: 0,
    focusCount: 0,
    tabSwitchCount: 0,
    lastBlurAt: null,
    lastFocusAt: null,
    isFocused: true
  };

  // -----------------------
  // Element cache
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

    dashrow: document.getElementById("dashrow")
  };

  // -----------------------
  // Header ticks & progress bar skeletons
  // -----------------------
  (function buildTicks() {
    if (!el.dashrow) return;
    for (let i = 0; i < 54; i++) {
      const d = document.createElement("div");
      d.className = "dash";
      el.dashrow.appendChild(d);
    }
  })();

  (function buildProgress() {
    if (!el.progress) return;
    const seg = Math.max(24, exam.questions.length * 2);
    el.progress.style.setProperty("--seg", seg);
    el.progress.innerHTML = "";
    for (let i = 0; i < seg; i++) {
      const s = document.createElement("div");
      s.className = "seg";
      el.progress.appendChild(s);
    }
  })();

  // -----------------------
  // Local storage save / restore
  // -----------------------
  let lastRemoteSaveMs = 0;

  function save() {
    if (!exam.storageKey) return;

    const elimsObj = {};
    Object.keys(state.elims).forEach((q) => {
      elimsObj[q] = Array.from(state.elims[q] || []);
    });

    try {
      const payload = {
        answers: state.answers,
        flags: state.flags,
        elims: elimsObj,
        remaining: state.remaining,
        index: state.index,
        startedAt: state.startedAt,
        attemptId: state.attemptId
      };

      localStorage.setItem(exam.storageKey, JSON.stringify(payload));
    } catch (e) {
      // storage may be full or disabled; fail silently
    }

    // Throttled remote save of in-progress state to Firestore via quiz-data.js
    if (
      window.quizData &&
      typeof window.quizData.saveSessionProgress === "function"
    ) {
      const now = Date.now();
      if (now - lastRemoteSaveMs >= 20000) {
        lastRemoteSaveMs = now;
        try {
          const progressState = buildProgressState(state);
          window.quizData.saveSessionProgress(progressState).catch(() => {});
        } catch (e) {
          // ignore progress sync errors
        }
      }
    }
  }

  function restore() {
    if (!exam.storageKey) return false;
    let raw;
    let had = false;
    try {
      raw = localStorage.getItem(exam.storageKey);
      if (!raw) return false;
      const data = JSON.parse(raw);

      had = true;

      if (data.answers && typeof data.answers === "object") {
        state.answers = data.answers;
      }
      if (data.flags && typeof data.flags === "object") {
        state.flags = data.flags;
      }
      if (data.elims && typeof data.elims === "object") {
        const result = {};
        Object.keys(data.elims).forEach((qid) => {
          result[qid] = new Set(data.elims[qid] || []);
        });
        state.elims = result;
      }
      if (typeof data.remaining === "number" && data.remaining > 0) {
        state.remaining = data.remaining;
      } else {
        state.remaining = exam.timeLimitSec || 0;
      }
      if (typeof data.index === "number") {
        state.index = clamp(data.index, 0, exam.questions.length - 1);
      }
      if (typeof data.startedAt === "number") {
        state.startedAt = data.startedAt;
      }
      if (typeof data.attemptId === "string") {
        state.attemptId = data.attemptId;
      }
    } catch (e) {
      // ignore bad JSON
      return false;
    }
    return had;
  }

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

    state.remaining--;
    if (state.remaining <= 0) {
      state.remaining = 0;
      updateTimeDisplay();
      save();
      finishExam();
      return;
    }

    updateTimeDisplay();
    save();
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
  // Per-question timing helpers
  // -----------------------
  function commitQuestionTime() {
    const q = exam.questions[state.index];
    if (!q || !state.currentQuestionEnterTs) return;
    const now = Date.now();
    const deltaSec = Math.max(
      0,
      Math.round((now - state.currentQuestionEnterTs) / 1000)
    );
    const prev = state.questionTimes[q.id] || 0;
    state.questionTimes[q.id] = prev + deltaSec;
    state.currentQuestionEnterTs = now;
  }

  function enterCurrentQuestion() {
    const q = exam.questions[state.index];
    state.currentQuestionEnterTs = Date.now();
    if (!q) return;
    if (!state.visits[q.id]) state.visits[q.id] = 0;
    state.visits[q.id] += 1;
  }

  // -----------------------
  // Rendering
  // -----------------------
  function render() {
    if (el.sectionTitle) {
      el.sectionTitle.textContent = exam.sectionTitle || "";
    }

    updateViewMode();
    renderQuestion();
    renderProgress();
    buildPopGrid();
    buildCheckGrid();
    updateNavs();
    updateFlagVisuals();
    updatePillFlag();
    updateTimeDisplay();
  }

  function renderQuestion() {
    const q = exam.questions[state.index];
    if (!q) return;

    if (el.qbadge) el.qbadge.textContent = state.index + 1;

    if (el.qtitle) el.qtitle.innerHTML = q.prompt;

    const letter = (i) => String.fromCharCode(65 + i);
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
    }

    if (el.choices) {
      el.choices.querySelectorAll(".choice").forEach((choice) => {
        const idx = Number(choice.dataset.choice);
        const input = choice.querySelector("input");

        choice.addEventListener("click", (ev) => {
          if (!state.eliminateMode) return;
          if (ev.target.tagName.toLowerCase() === "input") return;
          ev.preventDefault();
          toggleElimination(q.id, idx);
          choice.classList.toggle("eliminated");
          save();
        });

        input.addEventListener("change", () => {
          state.answers[q.id] = idx;
          save();
          renderProgress();
          buildPopGrid();
          buildCheckGrid();
        });
      });
    }

    const flagged = !!state.flags[q.id];
    if (el.flagTop && el.flagLabel) {
      el.flagTop.classList.toggle("on", flagged);
      el.flagTop.setAttribute("aria-pressed", String(flagged));
      el.flagLabel.textContent = flagged ? "For review" : "Mark for review";
    }

    if (el.elimToggle && el.elimHint) {
      el.elimToggle.classList.toggle("on", state.eliminateMode);
      el.elimToggle.setAttribute("aria-pressed", String(state.eliminateMode));
      el.elimHint.style.display = state.eliminateMode ? "block" : "none";
    }

    if (window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([el.qtitle, el.choices]).catch(() => {});
    }
  }

  function toggleElimination(qid, idx) {
    if (!state.elims[qid]) state.elims[qid] = new Set();
    const s = state.elims[qid];
    if (s.has(idx)) s.delete(idx);
    else s.add(idx);
  }

  function renderProgress() {
    if (!el.progress) return;
    const segs = el.progress.children.length;
    const active = Math.ceil(((state.index + 1) / exam.questions.length) * segs);
    for (let i = 0; i < segs; i++) {
      el.progress.children[i].classList.toggle("active", i < active);
    }
    if (el.pillText) {
      el.pillText.textContent = `Question ${state.index + 1} of ${exam.questions.length}`;
    }
  }

  function updatePillFlag() {
    const q = exam.questions[state.index];
    const flagged = !!state.flags[q.id];
    if (el.pillFlag) el.pillFlag.style.display = flagged ? "block" : "none";
  }

  function updateFlagVisuals() {
    const q = exam.questions[state.index];
    const flagged = !!state.flags[q.id];
    if (el.flagTop && el.flagLabel) {
      el.flagTop.classList.toggle("on", flagged);
      el.flagTop.setAttribute("aria-pressed", String(flagged));
      el.flagLabel.textContent = flagged ? "For review" : "Mark for review";
    }
  }

  // -----------------------
  // Question review grids
  // -----------------------
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
        render();
        save();
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
        render();
        window.scrollTo(0, 0);
        save();
      });

      el.checkGrid.appendChild(b);
    });
  }

  // -----------------------
  // Navigation & flags
  // -----------------------
  function updateNavs() {
    if (!el.next || !el.finish) return;
    const last = state.index === exam.questions.length - 1 && !state.reviewMode;
    el.next.style.display = last ? "none" : "inline-block";
    el.finish.style.display = last ? "inline-block" : "none";
  }

  function go(delta) {
    if (state.reviewMode) {
      state.reviewMode = false;
      render();
      return;
    }

    const k = clamp(state.index + delta, 0, exam.questions.length - 1);
    if (k === state.index) return;

    commitQuestionTime();
    state.index = k;
    enterCurrentQuestion();
    save();
    render();
  }

  function toggleFlag() {
    if (state.reviewMode) return;
    const q = exam.questions[state.index];
    if (!q) return;
    state.flags[q.id] = !state.flags[q.id];
    save();
    updateFlagVisuals();
    updatePillFlag();
    buildPopGrid();
    buildCheckGrid();
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

  // Keyboard shortcuts: arrows, F flag, E eliminate
  document.addEventListener("keydown", (e) => {
    if (state.finished) return;
    const tag = (e.target && e.target.tagName || "").toLowerCase();
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
  // Finish + summary
  // -----------------------
  function finishExam() {
    if (state.finished) return;
    state.finished = true;
    stopTimer();
    closePopover();

    // Credit time to the final question
    commitQuestionTime();

    const items = exam.questions.map((q, i) => {
      const chosen =
        typeof state.answers[q.id] === "number" ? state.answers[q.id] : null;
      return {
        number: i + 1,
        id: q.id,
        prompt: q.prompt,
        choices: q.choices,
        correctIndex: q.answerIndex,
        chosenIndex: chosen,
        correct: chosen === q.answerIndex,
        explanation: q.explanation || "",
        timeSpentSec: state.questionTimes[q.id] || 0,
        visits: state.visits[q.id] || 0
      };
    });

    const answeredCount = items.filter((it) => it.chosenIndex !== null).length;
    const correctCount = items.filter((it) => it.correct).length;
    const totalCount = items.length;

    const elapsedSec = state.startedAt
      ? Math.max(0, Math.round((Date.now() - state.startedAt) / 1000))
      : Math.max(0, (exam.timeLimitSec || 0) - state.remaining);

    const totals = {
      answered: answeredCount,
      correct: correctCount,
      total: totalCount,
      timeSpentSec: elapsedSec,
      scorePercent:
        totalCount > 0
          ? Math.round((correctCount / totalCount) * 100)
          : 0
    };

    const attemptId = state.attemptId || createAttemptId();

    const summary = {
      attemptId,
      sectionId: exam.sectionId,
      title: exam.sectionTitle,
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

    // Local attempt history (recorder-style)
    recordLocalAttempt(summary);

    // Save to Firestore via quiz-data.js if available
    if (window.quizData && typeof window.quizData.appendAttempt === "function") {
      window.quizData
        .appendAttempt(summary)
        .catch((err) =>
          console.error("quiz-engine: failed to save attempt to Firestore", err)
        );

      // Clear remote in-progress session if supported
      if (typeof window.quizData.clearSessionProgress === "function") {
        window.quizData.clearSessionProgress(exam.sectionId).catch(() => {});
      }
    }

    // Clear local in-progress state now that we're done
    try {
      if (exam.storageKey) {
        localStorage.removeItem(exam.storageKey);
      }
    } catch (e) {}

    // Also keep local summary for module-specific review pages
    try {
      if (exam.summaryKey) {
        localStorage.setItem(exam.summaryKey, JSON.stringify(summary));
      }
    } catch (e) {}

    if (exam.summaryHref) {
      window.location.href = exam.summaryHref;
    }
  }

  if (el.finish) el.finish.addEventListener("click", finishExam);

  // -----------------------
  // Popover for review grid
  // -----------------------
  const pill = el.pill;

  function openPopover() {
    if (!el.pop || !pill) return;
    el.pop.style.display = "block";
    pill.setAttribute("aria-expanded", "true");
  }

  function closePopover() {
    if (!el.pop || !pill) return;
    el.pop.style.display = "none";
    pill.setAttribute("aria-expanded", "false");
  }

  if (pill && el.pop) {
    pill.addEventListener("click", () => {
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
      render();
    });
  }

  document.addEventListener("click", (e) => {
    if (!el.pop || !pill) return;
    const inside =
      e.target === pill ||
      pill.contains(e.target) ||
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
    if (exam.pauseOnBlur) {
      stopTimer();
    }
  }

  function handleWindowFocus() {
    if (state.finished) return;
    state.focusCount += 1;
    state.isFocused = true;
    state.lastFocusAt = Date.now();
    if (exam.pauseOnBlur && state.remaining > 0 && !state.timerId) {
      startTimer();
    }
  }

  window.addEventListener("blur", handleWindowBlur);
  window.addEventListener("focus", handleWindowFocus);

  // -----------------------
  // Leave-page warning
  // -----------------------
  window.addEventListener("beforeunload", (e) => {
    if (state.finished) return;

    const hasWork =
      Object.keys(state.answers).length > 0 ||
      Object.keys(state.flags).length > 0 ||
      (exam.timeLimitSec && state.remaining < exam.timeLimitSec);

    if (!hasWork) return;

    e.preventDefault();
    e.returnValue = "";
  });

  // -----------------------
  // Init
  // -----------------------
  function resetPractice() {
    stopTimer();

    state.index = 0;
    state.answers = {};
    state.flags = {};
    state.elims = {};
    state.eliminateMode = false;
    state.remaining = exam.timeLimitSec || 0;
    state.finished = false;
    state.reviewMode = false;
    state.timerHidden = false;
    state.startedAt = Date.now();
    state.attemptId = createAttemptId();

    state.currentQuestionEnterTs = null;
    state.questionTimes = {};
    state.visits = {};

    state.blurCount = 0;
    state.focusCount = 0;
    state.tabSwitchCount = 0;
    state.lastBlurAt = null;
    state.lastFocusAt = null;
    state.isFocused = document.hasFocus();
    if (state.isFocused) {
      state.focusCount = 1;
      state.lastFocusAt = Date.now();
    }
  }

  function init() {
    resetPractice();
    const hadSaved = restore();

    if (hadSaved) {
      const resume = window.confirm(
        "Resume your last attempt for this quiz?"
      );
      if (!resume) {
        try {
          if (exam.storageKey) {
            localStorage.removeItem(exam.storageKey);
          }
        } catch (e) {}
        resetPractice();
      }
    }

    render();
    enterCurrentQuestion();
    startTimer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
