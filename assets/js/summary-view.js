// summary-view.js
// Generic renderer for quiz summary pages.
// Relies on a per-page config:
//
//   window.pageConfig = {
//     sectionId: 'math_circles_intro',
//     summaryKey: 'quizSummary_math_circles_intro',
//     fallbackKeys: ['old_key_1', 'old_key_2'], // optional
//     storageKey: 'quizState_math_circles_intro', // optional, used for "Retake"
//     practiceHref: 'circles.html',               // where "Retake" should go
//     titleOverride: 'Circles — Summary'          // optional hard override for header title
//   };
//
// HTML hooks (expected IDs):
//   #title, #meta, #scorePill, #headerCard, #qs, #empty, #retake, #clear

(function () {
  if (typeof window === 'undefined') return;

  const cfg = window.pageConfig || {};

  // -----------------------------
  // Helpers
  // -----------------------------

  function safeJSONParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn('summary-view: failed to parse JSON from storage', e);
      return null;
    }
  }

  function loadSummaryFromLocalStorage() {
    // 1. try primary key
    if (cfg.summaryKey) {
      const primary = safeJSONParse(localStorage.getItem(cfg.summaryKey));
      if (primary) return primary;
    }

    // 2. try fallback keys (for older builds)
    if (Array.isArray(cfg.fallbackKeys)) {
      for (const k of cfg.fallbackKeys) {
        const val = safeJSONParse(localStorage.getItem(k));
        if (val) return val;
      }
    }

    return null;
  }

  function formatDuration(sec) {
    if (!sec || sec <= 0) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h) return `${h}h ${m}m ${s}s`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }

  const letter = (i) => String.fromCharCode(65 + i);

  // -----------------------------
  // DOM hooks
  // -----------------------------

  const titleEl  = document.getElementById('title');
  const metaEl   = document.getElementById('meta');
  const pillEl   = document.getElementById('scorePill');
  const qsEl     = document.getElementById('qs');
  const emptyEl  = document.getElementById('empty');
  const headerEl = document.getElementById('headerCard');
  const retakeEl = document.getElementById('retake');
  const clearEl  = document.getElementById('clear');

  if (!qsEl || !headerEl || !pillEl || !metaEl || !titleEl) {
    console.warn('summary-view: required DOM elements not found; aborting.');
    return;
  }

  // -----------------------------
  // Main render
  // -----------------------------

  const data = loadSummaryFromLocalStorage();

  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    // Show empty state only
    if (emptyEl) emptyEl.style.display = 'block';
    headerEl.style.display = 'none';
    return;
  }

  const totals    = data.totals || {};
  const answered  = typeof totals.answered === 'number' ? totals.answered : 0;
  const correct   = typeof totals.correct === 'number'  ? totals.correct  : 0;
  const total     = typeof totals.total === 'number'    ? totals.total    : data.items.length;
  const timeSpent = typeof totals.timeSpentSec === 'number' ? totals.timeSpentSec : 0;
  const scorePct  = total ? Math.round((correct / total) * 100) : 0;
  const finishedAt = data.generatedAt || new Date().toISOString();

  const effectiveTitle =
    cfg.titleOverride ||
    data.title ||
    (cfg.sectionId ? `Summary — ${cfg.sectionId}` : 'Summary');

  titleEl.textContent = effectiveTitle;
  metaEl.textContent =
    `Answered ${answered}/${total} • Correct ${correct} • ` +
    `Time ${formatDuration(timeSpent)} • Completed ${new Date(finishedAt).toLocaleString()}`;

  pillEl.innerHTML = `
    <span>${scorePct}%</span>
    <span class="small">${correct} of ${total} correct</span>
  `;

  // Render question cards
  data.items.forEach((it, idx) => {
    const userIndex =
      (typeof it.chosenIndex === 'number') ? it.chosenIndex : null;
    const correctIndex =
      (typeof it.correctIndex === 'number') ? it.correctIndex : null;

    const isCorrect = userIndex !== null && userIndex === correctIndex;

    const qSection = document.createElement('section');
    qSection.className = 'q';

    const qNumber = it.number || (idx + 1);

    const resultLabel = isCorrect
      ? 'Correct'
      : (userIndex === null ? 'Not answered' : 'Incorrect');

    const resultClass = isCorrect
      ? 'qresult ok'
      : (userIndex === null ? 'qresult' : 'qresult no');

    const choicesHtml = (it.choices || []).map((choiceText, i) => {
      const isUser  = i === userIndex;
      const isRight = i === correctIndex;

      const choiceClasses = ['choice'];
      if (isRight) choiceClasses.push('correct-answer');
      if (isUser)  choiceClasses.push('user-answer');
      if (isUser && !isRight) choiceClasses.push('wrong-answer');

      const tags = [];

      if (isUser && isRight) {
        tags.push('<span class="tag you">Your answer</span>');
        tags.push('<span class="tag ok">Correct</span>');
      } else if (isUser && !isRight) {
        tags.push('<span class="tag you">Your answer</span>');
        tags.push('<span class="tag wrong">Wrong</span>');
      } else if (!isUser && isRight) {
        tags.push('<span class="tag correct">Correct answer</span>');
      }

      if (userIndex === null && isRight && tags.length === 0) {
        tags.push('<span class="tag correct">Correct answer</span>');
      }

      const tagsHtml = tags.join(' ');

      return `
        <div class="${choiceClasses.join(' ')}">
          <div class="choice-main">
            <b>${letter(i)}.</b> ${choiceText}
          </div>
          <div class="choice-tags">${tagsHtml}</div>
        </div>
      `;
    }).join('');

    qSection.innerHTML = `
      <div class="qhead">
        <div class="badge ${isCorrect ? 'ok' : 'no'}">${qNumber}</div>
        <div class="qmeta">
          <div class="${resultClass}">${resultLabel}</div>
          <div class="prompt">${it.prompt || ''}</div>
        </div>
      </div>
      <div class="choices">
        ${choicesHtml}
      </div>
      <div class="exp">
        <b>Explanation:</b>
        ${it.explanation || '—'}
      </div>
    `;

    qsEl.appendChild(qSection);
  });

  // If MathJax is present, typeset the page
  if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
    MathJax.typesetPromise([qsEl]).catch(() => {});
  }

  // -----------------------------
  // Buttons: Retake / Clear
  // -----------------------------

  if (retakeEl && cfg.practiceHref) {
    retakeEl.addEventListener('click', () => {
      // Optionally reset practice state if storageKey is provided
      if (cfg.storageKey) {
        try {
          const rawPractice = localStorage.getItem(cfg.storageKey);
          if (rawPractice) {
            const obj = JSON.parse(rawPractice);
            obj.answers = {};
            obj.flags   = {};
            obj.elims   = {};
            localStorage.setItem(cfg.storageKey, JSON.stringify(obj));
          }
        } catch (e) {
          console.warn('summary-view: failed to reset practice state', e);
        }
      }
      window.location.href = cfg.practiceHref;
    });
  }

  if (clearEl) {
    clearEl.addEventListener('click', () => {
      if (!confirm('Clear this summary from this device?')) return;

      if (cfg.summaryKey) {
        localStorage.removeItem(cfg.summaryKey);
      }
      if (Array.isArray(cfg.fallbackKeys)) {
        cfg.fallbackKeys.forEach((k) => localStorage.removeItem(k));
      }

      alert('Summary cleared. You can retake the set to generate a new one.');
      window.location.reload();
    });
  }
})();
