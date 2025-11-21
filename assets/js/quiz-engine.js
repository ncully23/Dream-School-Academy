(function () {
  const exam = window.examConfig;
  if (!exam) {
    console.error("quiz-engine.js: window.examConfig is missing.");
    return;
  }

  // -----------------------
  // State
  // -----------------------
  const state = {
    index: 0,
    answers: {},          // { qid: choiceIndex }
    flags: {},            // { qid: true/false }
    elims: {},            // { qid: Set(choiceIndex) }
    eliminateMode: false,
    remaining: exam.timeLimitSec || 0,
    timerId: null,
    timerHidden: false,
    finished: false,
    reviewMode: false
  };

  // -----------------------
  // Element cache
  // -----------------------
  const el = {
    sectionTitle: document.getElementById("sectionTitle"),
    timeLeft: document.getElementById("timeLeft"),
    toggleTimer: document.getElementById("toggleTimer"),

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

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

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
  function save() {
    if (!exam.storageKey) return;

    // Convert Sets to plain arrays
    const elimsObj = {};
    Object.keys(state.elims).forEach((q) => {
      elimsObj[q] = Array.from(state.elims[q] || []);
    });

    try {
      localStorage.setItem(
        exam.storageKey,
        JSON.stringify({
          answers: state.answers,
          flags: state.flags,
          elims: elimsObj,
          remaining: state.remaining,
          index: state.index
        })
      );
    } catch (e) {
      // storage may be full or disabled; fail silently
    }
  }

  function restore() {
    if (!exam.storageKey) return;
    let raw;
    try {
      raw = localStorage.getItem(exam.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);

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
    } catch (e) {
      // ignore bad JSON
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
    updateTimeDisplay(); // initial display
    state.timerId = setInterval(tick, 1000);
  }

  if (el.toggleTimer && el.timeLeft) {
    el.toggleTimer.addEventListener("click", () => {
      state.timerHidden = !state.timerHidden;
      el.toggleTimer.textContent = state.timerHidden ? "Show" : "Hide";
      updateTimeDisplay();
    });
  }

  // -----------------------
  // Rendering
  // -----------------------
  function render() {
    if (el.sectionTitle) {
      el.sectionTitle.textContent = exam.sectionTitle || "";
    }

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

    // Use innerHTML so TeX is kept
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

    // Wire choice interactions
    if (el.choices) {
      el.choices.querySelectorAll(".choice").forEach((choice) => {
        const idx = Number(choice.dataset.choice);
        const input = choice.querySelector("input");

        // Eliminate mode click
        choice.addEventListener("click", (ev) => {
          if (!state.eliminateMode) return;
          if (ev.target.tagName.toLowerCase() === "input") return; // let radio behave normally
          ev.preventDefault();
          toggleElimination(q.id, idx);
          choice.classList.toggle("eliminated");
          save();
        });

        // Answer selection
        input.addEventListener("change", () => {
          state.answers[q.id] = idx; // only one answer at a time
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

    // Ask MathJax to typeset the current card if available
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
        state.index = i;
        state.reviewMode = false;
        closePopover();
        render();
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
        state.index = i;
        state.reviewMode = false;
        render();
        window.scrollTo(0, 0);
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
    state.index = k;
    save();
    render();
  }

  function toggleFlag() {
    if (state.reviewMode) return;
    const q = exam.questions[state.index];
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

  // -----------------------
  // Finish + summary
  // -----------------------
  function finishExam() {
    if (state.finished) return;
    state.finished = true;
    if (state.timerId) clearInterval(state.timerId);
    closePopover();

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
        explanation: q.explanation || ""
      };
    });

    const totals = {
      answered: items.filter((it) => it.chosenIndex !== null).length,
      correct: items.filter((it) => it.correct).length,
      total: items.length,
      timeSpentSec: (exam.timeLimitSec || 0) - state.remaining
    };

    const summary = {
      title: exam.sectionTitle,
      generatedAt: new Date().toISOString(),
      totals,
      items
    };

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
      state.reviewMode = true;
      closePopover();
      render(); // currently reviewMode just changes nav behavior
    });
  }

  // close popup when clicking outside
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
  // Init
  // -----------------------
  function resetPractice() {
    state.index = 0;
    state.answers = {};
    state.flags = {};
    state.elims = {};
    state.eliminateMode = false;
    state.remaining = exam.timeLimitSec || 0;
    state.finished = false;
    state.reviewMode = false;
    state.timerHidden = false;
  }

  function init() {
    resetPractice();
    restore();   // pull saved work if it exists
    render();
    startTimer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
