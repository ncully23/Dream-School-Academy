(function () {
  "use strict";

  // Prefer new config name, but keep backward compatibility.
  const exam = window.dsaQuizConfig || window.examConfig;
  if (!exam) {
    console.error("quiz-engine.js: missing window.dsaQuizConfig (or window.examConfig).");
    return;
  }

  // -----------------------
  // Question identity helpers (Step 4B)
  // -----------------------
  function normalizeQuestion(q) {
    // Back-compat:
    // - If q.questionId missing but q.id exists, treat q.id as questionId.
    // - If q.version missing, default to 1.
    const questionId = (q && (q.questionId || q.id)) ? String(q.questionId || q.id) : "";
    const version =
      q && (typeof q.version === "number" || typeof q.version === "string")
        ? Number(q.version)
        : 1;

    return { questionId, version: Number.isFinite(version) ? version : 1 };
  }

  function questionKey(q) {
    const n = normalizeQuestion(q);
    // If questionId is somehow empty, at least avoid crashing.
    const id = n.questionId || "unknown.question";
    return `${id}@v${n.version}`;
  }

  function keyToSafeDomId(key) {
    // Make safe for HTML id/name attributes
    return String(key).replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  // Build a fast lookup: key -> question
  const qList = Array.isArray(exam.questions) ? exam.questions : [];
  const qByKey = new Map();
  qList.forEach((q) => {
    qByKey.set(questionKey(q), q);
  });

  // -----------------------
  // Helpers
  // -----------------------
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function createAttemptId() {
    return "t_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  }

  // Whether this quiz should ever restore draft state.
  // You wanted: "start fresh if you leave the page"
  const allowDraftSave = exam.allowDraftSave !== false;

  // -----------------------
  // State (keys are questionKey now)
  // -----------------------
  const state = {
    index: 0,

    // { [qKey]: choiceIndex }
    answers: {},

    // { [qKey]: true/false }
    flags: {},

    // { [qKey]: Set(choiceIndex) }
    elims: {},

    eliminateMode: false,
    remaining: exam.timeLimitSec || 0,
    timerId: null,
    timerHidden: false,
    finished: false,
    reviewMode: false,
    startedAt: null,
    attemptId: null,

    // Timing now keyed by qKey
    currentQuestionEnterTs: null,
    questionTimes: {}, // { [qKey]: totalSeconds }
    visits: {},        // { [qKey]: count }

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

    dashrow: document.getElementById("dashrow"),

    // optional titles if present in your HTML
    popTitle: document.getElementById("popTitle"),
    checkTitle: document.getElementById("checkTitle"),
    practiceBanner: document.getElementById("practiceBanner")
  };

  // -----------------------
  // Header ticks & progress skeleton
  // -----------------------
  (function buildTicks() {
    if (!el.dashrow) return;
    el.dashrow.innerHTML = "";
    for (let i = 0; i < 54; i++) {
      const d = document.createElement("div");
      d.className = "dash";
      el.dashrow.appendChild(d);
    }
  })();

  (function buildProgress() {
    if (!el.progress) return;
    const seg = Math.max(24, qList.length * 2);
    el.progress.style.setProperty("--seg", seg);
    el.progress.innerHTML = "";
    for (let i = 0; i < seg; i++) {
      const s = document.createElement("div");
      s.className = "seg";
      el.progress.appendChild(s);
    }
  })();

  // -----------------------
  // Build a lightweight progressState for quiz-data.js (Firestore in-progress)
  // Keys will now be qKey.
  // -----------------------
  function buildProgressState() {
    const q = qList[state.index];
    const qKey = q ? questionKey(q) : null;

    const answers = {};
    Object.keys(state.answers).forEach((k) => {
      const qq = qByKey.get(k);
      const chosenIndex = state.answers[k];
      const correctIndex =
        qq && typeof qq.answerIndex === "number" ? qq.answerIndex : null;

      const isCorrect =
        typeof chosenIndex === "number" &&
        typeof correctIndex === "number" &&
        chosenIndex === correctIndex;

      const n = qq ? normalizeQuestion(qq) : { questionId: "", version: 1 };

      answers[k] = {
        questionId: n.questionId,
        version: n.version,
        chosenIndex,
        correctIndex,
        isCorrect
      };
    });

    return {
      quizId: exam.quizId || exam.sectionId || "",
      sectionId: exam.sectionId || "",
      title: exam.title || exam.sectionTitle || "",
      lastQuestionKey: qKey,
      lastQuestionIndex: state.index,
      lastScreenIndex: 0,
      timerHidden: state.timerHidden,
      questionCountHidden: false,
      reviewMode: state.reviewMode,
      answers
    };
  }

  // -----------------------
  // Local storage save / restore
  // -----------------------
  let lastRemoteSaveMs = 0;

  function save() {
    // Respect your "start fresh" policy: no draft restore/save when disabled
    if (!allowDraftSave) {
      // Still allow periodic remote progress if you want later; for now keep as-is.
      // If you also want to disable remote in-progress saves, set this to return early.
    } else {
      if (exam.storageKey) {
        const elimsObj = {};
        Object.keys(state.elims).forEach((k) => {
          elimsObj[k] = Array.from(state.elims[k] || []);
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
          // ignore
        }
      }
    }

    // Throttled remote save of in-progress state to Firestore via quiz-data.js
    if (window.quizData && typeof window.quizData.saveSessionProgress === "function") {
      const now = Date.now();
      if (now - lastRemoteSaveMs >= 20000) {
        lastRemoteSaveMs = now;
        try {
          const progressState = buildProgressState();
          window.quizData.saveSessionProgress(progressState).catch(() => {});
        } catch (e) {
          // ignore
        }
      }
    }
  }

  function restore() {
    if (!allowDraftSave) return false;
    if (!exam.storageKey) return false;

    try {
      const raw = localStorage.getItem(exam.storageKey);
      if (!raw) return false;
      const data = JSON.parse(raw);

      if (data.answers && typeof data.answers === "object") state.answers = data.answers;
      if (data.flags && typeof data.flags === "object") state.flags = data.flags;

      if (data.elims && typeof data.elims === "object") {
        const result = {};
        Object.keys(data.elims).forEach((k) => {
          result[k] = new Set(data.elims[k] || []);
        });
        state.elims = result;
      }

      if (typeof data.remaining === "number" && data.remaining > 0) {
        state.remaining = data.remaining;
      } else {
        state.remaining = exam.timeLimitSec || 0;
      }

      if (typeof data.index === "number") {
        state.index = clamp(data.index, 0, qList.length - 1);
      }

      if (typeof data.startedAt === "number") state.startedAt = data.startedAt;
      if (typeof data.attemptId === "string") state.attemptId = data.attemptId;

      return true;
    } catch (e) {
      return false;
    }
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
      save();
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
  // Per-question timing helpers (keyed by qKey)
  // -----------------------
  function currentQ() {
    return qList[state.index] || null;
  }

  function commitQuestionTime() {
    const q = currentQ();
    if (!q || !state.currentQuestionEnterTs) return;
    const k = questionKey(q);

    const now = Date.now();
    const deltaSec = Math.max(0, Math.round((now - state.currentQuestionEnterTs) / 1000));
    const prev = state.questionTimes[k] || 0;
    state.questionTimes[k] = prev + deltaSec;
    state.currentQuestionEnterTs = now;
  }

  function enterCurrentQuestion() {
    const q = currentQ();
    state.currentQuestionEnterTs = Date.now();
    if (!q) return;
    const k = questionKey(q);
    if (!state.visits[k]) state.visits[k] = 0;
    state.visits[k] += 1;
  }

  // -----------------------
  // Rendering
  // -----------------------
  function render() {
    if (el.sectionTitle) el.sectionTitle.textContent = exam.sectionTitle || exam.title || "";

    if (el.popTitle) el.popTitle.textContent = exam.sectionTitle || exam.title || "Questions";
    if (el.checkTitle) el.checkTitle.textContent = exam.sectionTitle || exam.title || "Questions";

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
    const q = currentQ();
    if (!q) return;

    const k = questionKey(q);
    const safeKey = keyToSafeDomId(k);

    if (el.qbadge) el.qbadge.textContent = state.index + 1;
    if (el.qtitle) el.qtitle.innerHTML = q.prompt || "";

    const letter = (i) => String.fromCharCode(65 + i);
    const elimSet = state.elims[k] || new Set();

    if (el.choices) {
      el.choices.innerHTML = (q.choices || [])
        .map((t, i) => {
          const id = `${safeKey}_c${i}`;
          const checked = state.answers[k] === i ? "checked" : "";
          const elimClass = elimSet.has(i) ? "eliminated" : "";
          return `
            <label class="choice ${elimClass}" data-choice="${i}" for="${id}">
              <input id="${id}" type="radio" name="${safeKey}" value="${i}" ${checked} />
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
          if (ev.target && ev.target.tagName && ev.target.tagName.toLowerCase() === "input") return;
          ev.preventDefault();
          toggleElimination(k, idx);
          choice.classList.toggle("eliminated");
          save();
        });

        input.addEventListener("change", () => {
          state.answers[k] = idx;
          save();
          renderProgress();
          buildPopGrid();
          buildCheckGrid();
        });
      });
    }

    const flagged = !!state.flags[k];
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

    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise([el.qtitle, el.choices]).catch(() => {});
    }
  }

  function toggleElimination(qKey, idx) {
    if (!state.elims[qKey]) state.elims[qKey] = new Set();
    const s = state.elims[qKey];
    if (s.has(idx)) s.delete(idx);
    else s.add(idx);
  }

  function renderProgress() {
    if (!el.progress) return;

    const segs = el.progress.children.length;
    const active = qList.length
      ? Math.ceil(((state.index + 1) / qList.length) * segs)
      : 0;

    for (let i = 0; i < segs; i++) {
      el.progress.children[i].classList.toggle("active", i < active);
    }

    if (el.pillText) {
      el.pillText.textContent = `Question ${state.index + 1} of ${qList.length}`;
    }
  }

  function updatePillFlag() {
    const q = currentQ();
    if (!q) return;
    const flagged = !!state.flags[questionKey(q)];
    if (el.pillFlag) el.pillFlag.style.display = flagged ? "block" : "none";
  }

  function updateFlagVisuals() {
    const q = currentQ();
    if (!q) return;
    const flagged = !!state.flags[questionKey(q)];
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

    qList.forEach((q, i) => {
      const k = questionKey(q);
      const b = document.createElement("button");
      b.className = "nbtn";
      b.textContent = String(i + 1);

      const answered = typeof state.answers[k] === "number";
      const flagged = !!state.flags[k];

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

    qList.forEach((q, i) => {
      const k = questionKey(q);
      const b = document.createElement("button");
      b.className = "nbtn";
      b.textContent = String(i + 1);

      const answered = typeof state.answers[k] === "number";
      const flagged = !!state.flags[k];

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
    const last = state.index === qList.length - 1 && !state.reviewMode;
    el.next.style.display = last ? "none" : "inline-block";
    el.finish.style.display = last ? "inline-block" : "none";
  }

  function go(delta) {
    if (state.reviewMode) {
      state.reviewMode = false;
      render();
      return;
    }

    const k = clamp(state.index + delta, 0, qList.length - 1);
    if (k === state.index) return;

    commitQuestionTime();
    state.index = k;
    enterCurrentQuestion();
    save();
    render();
  }

  function toggleFlag() {
    if (state.reviewMode) return;
    const q = currentQ();
    if (!q) return;
    const k = questionKey(q);
    state.flags[k] = !state.flags[k];
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
      save();
    });
  }

  if (el.back) el.back.addEventListener("click", () => go(-1));
  if (el.next) el.next.addEventListener("click", () => go(1));

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
        save();
      }
    }
  });

  // -----------------------
  // Finish + summary (store questionId+version and solution)
  // -----------------------
  function finishExam() {
    if (state.finished) return;
    state.finished = true;
    stopTimer();
    closePopover();

    commitQuestionTime();

    const items = qList.map((q, i) => {
      const k = questionKey(q);
      const n = normalizeQuestion(q);

      const chosen = typeof state.answers[k] === "number" ? state.answers[k] : null;

      // Support both your old "explanation" and your new "solution" object
      const solutionObj = q.solution && typeof q.solution === "object" ? q.solution : null;
      const explanationText =
        typeof q.explanation === "string"
          ? q.explanation
          : (solutionObj && typeof solutionObj.approach === "string")
            ? solutionObj.approach
            : "";

      return {
        number: i + 1,
        questionKey: k,
        questionId: n.questionId,
        version: n.version,

        prompt: q.prompt,
        choices: q.choices,

        correctIndex: q.answerIndex,
        chosenIndex: chosen,
        correct: chosen === q.answerIndex,

        // keep both forms to be safe
        explanation: explanationText,
        solution: solutionObj,

        timeSpentSec: state.questionTimes[k] || 0,
        visits: state.visits[k] || 0
      };
    });

    const answeredCount = items.filter((it) => it.chosenIndex !== null).length;
    const correctCount  = items.filter((it) => it.correct).length;
    const totalCount    = items.length;

    const elapsedSec = state.startedAt
      ? Math.max(0, Math.round((Date.now() - state.startedAt) / 1000))
      : Math.max(0, (exam.timeLimitSec || 0) - state.remaining);

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
      quizId: exam.quizId || exam.sectionId || "",
      sectionId: exam.sectionId || "",
      title: exam.sectionTitle || exam.title || "",
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

    function finalizeAndRedirect() {
      // Clear local in-progress state
      try {
        if (exam.storageKey) localStorage.removeItem(exam.storageKey);
      } catch (e) {}

      // Keep local summary for your summary/review page
      try {
        if (exam.summaryKey) localStorage.setItem(exam.summaryKey, JSON.stringify(summary));
        else localStorage.setItem("dsa-last-summary", JSON.stringify(summary));
      } catch (e) {}

      if (exam.summaryHref) window.location.href = exam.summaryHref;
    }

    if (window.quizData && typeof window.quizData.appendAttempt === "function") {
      window.quizData.appendAttempt(summary)
        .then((res) => {
          if (window.quizData.clearSessionProgress) {
            return window.quizData.clearSessionProgress(exam.sectionId || exam.quizId || "").catch(() => {});
          }
        })
        .catch(() => {})
        .finally(finalizeAndRedirect);
    } else {
      finalizeAndRedirect();
    }
  }

  if (el.finish) el.finish.addEventListener("click", finishExam);

  // -----------------------
  // Popover
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
      save();
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

    // If allowDraftSave is false, we NEVER restore.
    const hadSaved = restore();

    // Optional resume prompt if draft saving is enabled
    if (allowDraftSave && hadSaved) {
      const resume = window.confirm("Resume your last attempt for this quiz?");
      if (!resume) {
        try {
          if (exam.storageKey) localStorage.removeItem(exam.storageKey);
        } catch (e) {}
        resetPractice();
      }
    } else {
      // enforce "fresh start" by removing any old draft key
      try {
        if (exam.storageKey) localStorage.removeItem(exam.storageKey);
      } catch (e) {}
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
