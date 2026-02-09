// /assets/js/quiz-engine.js
import { routes } from "/assets/js/lib/routes.js";
import { saveAttempt } from "/assets/js/lib/attempt-writer.js";

(function () {
  "use strict";

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
  // =========================================================

  // -----------------------
  // 0) URL + registry helpers
  // -----------------------
  function getQuizIdFromUrl() {
    try {
      return new URLSearchParams(location.search).get("quizId");
    } catch {
      return null;
    }
  }

  function getQuizIdFromHash() {
    try {
      const h = (location.hash || "").replace(/^#/, "").trim();
      return h || null;
    } catch {
      return null;
    }
  }

  function getQuizIdFromPathFallback() {
    try {
      const parts = location.pathname.split("/").filter(Boolean);
      const practiceIdx = parts.indexOf("practice");
      if (practiceIdx >= 0 && parts.length > practiceIdx + 1) {
        const candidate = parts[practiceIdx + 1];
        if (candidate && candidate !== "quiz.html") return candidate;
      }
      return null;
    } catch {
      return null;
    }
  }

  function getLastQuizId() {
    try {
      return localStorage.getItem("dsa:lastQuizId");
    } catch {
      return null;
    }
  }

  function setLastQuizId(quizId) {
    try {
      localStorage.setItem("dsa:lastQuizId", String(quizId));
    } catch {}
  }

  function getDefaultQuizId(registry) {
    if (!registry) return null;
    const keys = Object.keys(registry);
    return keys.length ? keys[0] : null;
  }

  function getRegistry() {
    return window.QUIZ_REGISTRY || window.quizRegistry || window.QUIZZES || null;
  }

  function resolveQuizId(registry) {
    return (
      getQuizIdFromUrl() ||
      getQuizIdFromHash() ||
      getQuizIdFromPathFallback() ||
      getLastQuizId() ||
      getDefaultQuizId(registry)
    );
  }

  function resolveReviewUrl(attemptId) {
    try {
      if (routes && typeof routes.review === "function") return routes.review(attemptId);
    } catch {}
    return `/pages/review.html?attemptId=${encodeURIComponent(attemptId)}`;
  }

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
  function hashStringToUint32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pickQuestionsFromBank(bank, cfg, attemptIdForSeed) {
    if (!bank || !Array.isArray(bank.questions)) return [];

    const all = bank.questions.slice();
    const pickCount = Number(cfg.pickCount || cfg.count || 0) || all.length;

    const seedMode = cfg.seedMode || null;

    let rng = Math.random;
    if (seedMode === "perAttempt" && attemptIdForSeed) {
      rng = mulberry32(hashStringToUint32(String(attemptIdForSeed)));
    } else if (seedMode === "perQuiz" && cfg.__quizId) {
      rng = mulberry32(hashStringToUint32(String(cfg.__quizId)));
    }

    shuffleInPlace(all, rng);

    const n = Math.max(0, Math.min(pickCount, all.length));
    return all.slice(0, n);
  }

  // -----------------------
  // 2) Storage keys (draft-only; attempts handled by attempt-writer)
  // -----------------------
  function createAttemptId() {
    return "t_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  }

  function getDraftKey(quizId) {
    return `dsa:draft:${quizId}`;
  }

  function safeRemoveStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  // -----------------------
  // 3) DOM cache
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

    popTitle: document.getElementById("popTitle"),
    checkTitle: document.getElementById("checkTitle"),
  };

  function showFatal(message) {
    console.error("[quiz-engine] " + message);
    const box = document.createElement("div");
    box.style.cssText =
      "max-width:980px;margin:14px auto;padding:12px 14px;background:#fff;border:1px solid #c00;border-radius:10px;" +
      "font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:#111;";
    box.innerHTML = `<h2 style="margin:0 0 6px;font-size:18px">Quiz failed to load</h2><p style="margin:0">${String(
      message
    )}</p>`;
    (document.body || document.documentElement).prepend(box);

    if (el.sectionTitle) el.sectionTitle.textContent = "Quiz failed to load";
    if (el.timeLeft) el.timeLeft.textContent = "--:--";
    document.title = "Quiz failed to load";
  }

  function showSaveBanner(message, onRetry) {
    console.error("[quiz-engine] save failed:", message);

    // Non-fatal UI (keeps user on page)
    const box = document.createElement("div");
    box.style.cssText =
      "max-width:980px;margin:14px auto;padding:12px 14px;background:#fff;border:1px solid #eab308;border-radius:10px;" +
      "font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:#111;" +
      "display:flex;align-items:center;justify-content:space-between;gap:10px;";
    box.innerHTML = `
      <div>
        <div style="font-weight:700;margin-bottom:2px">Couldn’t save your attempt to the cloud</div>
        <div style="font-size:14px;opacity:.9">${escapeHtml(message)} (Your attempt is still saved locally.)</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <button id="dsaRetrySave" style="padding:10px 12px;border-radius:10px;border:1px solid #111;background:#111;color:#fff;cursor:pointer">Retry save</button>
      </div>
    `.trim();

    const root = document.body || document.documentElement;
    root.prepend(box);

    const btn = box.querySelector("#dsaRetrySave");
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Retrying...";
        try {
          await onRetry();
        } finally {
          btn.disabled = false;
          btn.textContent = "Retry save";
        }
      });
    }

    return box;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // -----------------------
  // 4) UI scaffolding
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
  // 5) Normalize bank question objects -> engine format
  // -----------------------
  function normalizeDifficulty(raw) {
    if (raw == null) return null;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const s = String(raw).trim().toLowerCase();
    if (!s) return null;
    return s;
  }

  function normalizeQuestion(raw, idx) {
    const questionId = raw.questionId || raw.id || `q_${idx + 1}`;
    const version = raw.version ?? raw.questionVersion ?? 1;

    const promptText = raw.prompt ?? raw.promptText ?? "";
    const promptHtml = raw.promptHtml ?? null;

    const choices = Array.isArray(raw.choices) ? raw.choices : [];
    const answerIndex = Number.isFinite(raw.answerIndex) ? raw.answerIndex : null;

    const sol = raw.solution || {};
    const explanation = raw.explanation || sol.approach || "";
    const steps = raw.steps || sol.steps || null;

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

  function normalizeQuestions(list) {
    return (list || []).map((q, i) => normalizeQuestion(q, i));
  }

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
    return null;
  }

  function resolveAttemptType(cfg, bank) {
    const explicit = String(cfg?.attemptType || "").trim().toLowerCase();
    if (explicit === "topic" || explicit === "random") return explicit;

    // Heuristic: if you're subselecting/shuffling from a bank, treat as random
    if (cfg && (cfg.random === true || cfg.seedMode || cfg.pickCount || cfg.count)) return "random";

    // If bank explicitly marks itself as random, honor it (optional future)
    if (bank && String(bank.attemptType || "").toLowerCase() === "random") return "random";

    return "topic";
  }

  // -----------------------
  // 6) Core engine (runs after config+bank are loaded)
  // -----------------------
  function runEngine(exam) {
    if (!exam || !Array.isArray(exam.questions) || exam.questions.length === 0) {
      showFatal("No questions found for this quiz.");
      return;
    }

    const quizIdForKeys = String(exam.quizId || exam.sectionId || "unknown-quiz");
    const draftKey = getDraftKey(quizIdForKeys);

    // Always start fresh (no resume)
    safeRemoveStorage(draftKey);
    if (window.quizData && typeof window.quizData.clearSessionProgress === "function") {
      try {
        window.quizData.clearSessionProgress(exam.sectionId).catch(() => {});
      } catch {}
    }

    const state = {
      index: 0,
      answers: {},
      flags: {},
      elims: {},
      eliminateMode: false,

      remaining: exam.timeLimitSec || 0,
      timerId: null,
      timerHidden: false,
      finished: false,
      reviewMode: false,

      startedAt: Date.now(),
      attemptId: exam.attemptId || createAttemptId(),

      currentQuestionEnterTs: null,
      questionTimes: {},
      visits: {},

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
    // View mode
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
      if (title) document.title = title;
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

    function renderPrompt(q) {
      if (!el.qtitle) return;
      if (q.promptHtml) el.qtitle.innerHTML = q.promptHtml;
      else el.qtitle.textContent = q.promptText || "";
    }

    function renderQuestion() {
      const q = exam.questions[state.index];
      if (!q) return;

      if (el.qbadge) el.qbadge.textContent = String(state.index + 1);
      renderPrompt(q);

      const elimSet = state.elims[q.id] || new Set();

      if (el.choices) {
        el.choices.innerHTML = q.choices
          .map((t, i) => {
            const id = `${q.id}_c${i}`;
            const checked = state.answers[q.id] === i ? "checked" : "";
            const elimClass = elimSet.has(i) ? "eliminated" : "";
            return `
              <label class="choice ${elimClass}" data-choice="${i}" for="${escapeHtml(id)}">
                <input id="${escapeHtml(id)}" type="radio" name="${escapeHtml(q.id)}" value="${i}" ${checked} />
                <div class="text"><b>${letter(i)}.</b> ${escapeHtml(String(t))}</div>
                <div class="letter">${letter(i)}</div>
              </label>
            `;
          })
          .join("");

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

      const flagged = !!state.flags[q.id];
      if (el.flagTop && el.flagLabel) {
        el.flagTop.classList.toggle("on", flagged);
        el.flagTop.setAttribute("aria-pressed", String(flagged));
        el.flagLabel.textContent = flagged ? "For review" : "Mark for review";
      }

      if (el.elimToggle && el.elimHint) {
        el.elimToggle.classList.toggle("on", state.eliminateMode);
        el.elimToggle.setAttribute("aria-pressed", String(state.eliminateMode));
        el.elimHint.hidden = !state.eliminateMode;
      }

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
        el.elimHint.hidden = !state.eliminateMode;
      });
    }

    if (el.back) el.back.addEventListener("click", () => go(-1));
    if (el.next) el.next.addEventListener("click", () => go(1));

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
          el.elimHint.hidden = !state.eliminateMode;
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
    async function finishExam() {
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

          topic: q.topic || null,
          skill: q.skill || null,
          difficulty: q.difficulty || null,

          id: q.id,
          prompt: q.promptHtml ? q.promptHtml : q.promptText,
          promptIsHtml: !!q.promptHtml,

          choices: q.choices,
          correctIndex: q.answerIndex,
          chosenIndex: chosen,
          correct: chosen === q.answerIndex,

          explanation: q.explanation || "",
          steps: Array.isArray(q.steps) ? q.steps : undefined,
          solution: q.solution || undefined,

          timeSpentSec: state.questionTimes[q.id] || 0,
          visits: state.visits[q.id] || 0,
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
        scorePercent: totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0,
      };

      const attemptId = state.attemptId || createAttemptId();
      const attemptType = String(exam.attemptType || "topic").toLowerCase() === "random" ? "random" : "topic";

      const attempt = {
        attemptId,
        attemptType,

        quizId: exam.quizId,
        sectionId: exam.sectionId,
        title: exam.sectionTitle || exam.title || null,

        bank: {
          bankId: exam.bankId || null,
          bankVersion: exam.bankVersion || null,
          title: exam.bankTitle || (exam.sectionTitle || exam.title) || null,
          description: exam.bankDescription || null,
          skills: Array.isArray(exam.bankSkills) ? exam.bankSkills : null,
        },

        // Random metadata (optional but important for diagnosing “random attempts not saving”)
        pick: attemptType === "random" ? exam.pickMeta || null : null,

        generatedAt: new Date().toISOString(),
        totals,
        items,

        uiState: {
          timerHidden: state.timerHidden,
          reviewMode: state.reviewMode,
          lastQuestionIndex: state.index,
        },
        sessionMeta: {
          blurCount: state.blurCount,
          focusCount: state.focusCount,
          tabSwitchCount: state.tabSwitchCount,
          questionTimes: state.questionTimes,
          visits: state.visits,
        },
      };

      const reviewUrl = resolveReviewUrl(attemptId);

      // Save through unified writer (Firestore + local fallback)
      const doSave = async () => {
        const res = await saveAttempt(attempt);
        if (res && res.ok) {
          safeRemoveStorage(draftKey);
          if (window.quizData && typeof window.quizData.clearSessionProgress === "function") {
            try {
              window.quizData.clearSessionProgress(exam.sectionId).catch(() => {});
            } catch {}
          }
          window.location.href = reviewUrl;
          return true;
        }
        return false;
      };

      const ok = await doSave();
      if (!ok) {
        // Keep the user on the page; allow manual retry.
        showSaveBanner("Check your sign-in / connection and retry.", async () => {
          const ok2 = await doSave();
          if (!ok2) {
            // still failing; leave banner in place
          }
        });
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
  // 7) Boot: resolve quizId -> registry -> bank -> pick -> run
  // -----------------------
  async function boot() {
    // If some page already set window.dsaQuizConfig, use it (topic-style)
    if (window.dsaQuizConfig && Array.isArray(window.dsaQuizConfig.questions)) {
      const cfg = window.dsaQuizConfig;
      const norm = normalizeQuestions(cfg.questions);
      const err = validateQuestions(norm);
      if (err) return void showFatal(err);

      runEngine({
        attemptId: cfg.attemptId,
        attemptType: (String(cfg.attemptType || "topic").toLowerCase() === "random" ? "random" : "topic"),

        quizId: cfg.quizId || cfg.sectionId,
        sectionId: cfg.sectionId || cfg.quizId,

        title: cfg.title || cfg.sectionTitle,
        sectionTitle: cfg.sectionTitle || cfg.title,

        bankId: cfg.bankId || null,
        bankVersion: cfg.bankVersion || null,
        bankTitle: cfg.bankTitle || null,
        bankDescription: cfg.bankDescription || null,
        bankSkills: cfg.bankSkills || null,

        timeLimitSec: cfg.timeLimitSec || 0,
        pauseOnBlur: !!cfg.pauseOnBlur,
        questions: norm,
      });
      return;
    }

    const registry = getRegistry();
    if (!registry) {
      showFatal("Quiz registry not found. Ensure /assets/js/quiz-registry.js defines window.QUIZ_REGISTRY.");
      return;
    }

    const quizId = resolveQuizId(registry);
    if (!quizId) {
      showFatal("Could not resolve quizId. Use ?quizId=... or ensure registry is populated.");
      return;
    }

    setLastQuizId(quizId);

    const cfg = registry[quizId];
    if (!cfg) {
      showFatal(`Unknown quizId: ${escapeHtml(quizId)} (no entry found in window.QUIZ_REGISTRY).`);
      return;
    }

    cfg.__quizId = quizId;

    const bankUrl = cfg.bankUrl || cfg.jsonUrl || cfg.url;
    if (!bankUrl) {
      showFatal(`Quiz ${escapeHtml(quizId)} exists in registry but is missing bankUrl.`);
      return;
    }

    const bank = await loadJson(bankUrl);

    // Determine attempt type
    const attemptType = resolveAttemptType(cfg, bank);

    // Build questions (random pick if configured; otherwise use full bank order)
    const attemptId = createAttemptId();
    const pickedRaw = attemptType === "random" ? pickQuestionsFromBank(bank, cfg, attemptId) : (bank.questions || []);
    const questions = normalizeQuestions(pickedRaw);

    const err = validateQuestions(questions);
    if (err) return void showFatal(err);

    const title = cfg.title || bank.title || quizId;
    const sectionTitle = cfg.sectionTitle || title;
    const timeLimitSec = Number(cfg.timeLimitSec || cfg.timerSec || cfg.timeLimit || 0) || 0;

    // Random pick metadata for persistence/debugging
    const pickMeta =
      attemptType === "random"
        ? {
            pickCount: Number(cfg.pickCount || cfg.count || 0) || questions.length,
            seedMode: cfg.seedMode || null,
            seedValue:
              cfg.seedMode === "perAttempt"
                ? String(attemptId)
                : (cfg.seedMode === "perQuiz" ? String(quizId) : null),
            picked: questions.map((q) => ({
              questionId: q.questionId || q.id,
              version: q.version || 1,
            })),
          }
        : null;

    runEngine({
      attemptId,
      attemptType,

      quizId: quizId,
      sectionId: quizId,
      title,
      sectionTitle,
      timeLimitSec,
      pauseOnBlur: !!cfg.pauseOnBlur,
      questions,

      bankId: bank.bankId || null,
      bankVersion: bank.bankVersion ?? null,
      bankTitle: bank.title || null,
      bankDescription: bank.description || null,
      bankSkills: Array.isArray(bank.skills) ? bank.skills : null,

      pickMeta,
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
