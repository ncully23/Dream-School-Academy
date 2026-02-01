// /assets/js/pages/practicepage.js
// Renders Practice index from /assets/configs/quizzes.json
// Assumes:
//  - each quiz entry has: quizId, title/sectionTitle, subject ("math"|"rw"), kind ("topic"|"fulltest")
//  - optional: questionCount, timeLimitSec, difficulty, bank, tags
// Links:
//  - Preview: /pages/preview.html?quizId=...
//  - Quiz:    /pages/quiz.html?quizId=...

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function qs(id) {
  return document.getElementById(id);
}

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function formatTime(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return "";
  const m = Math.round(n / 60);
  return `${m} min`;
}

function formatMeta(q) {
  const subj = q.subject === "math" ? "Math" : q.subject === "rw" ? "Reading & Writing" : "";
  const count = Number.isFinite(Number(q.questionCount)) ? `${q.questionCount} questions` : "";
  const time = formatTime(q.timeLimitSec);
  const diff = q.difficulty ? String(q.difficulty) : "";

  // Prefer a compact, consistent ordering
  const bits = [subj, count, time, diff].filter(Boolean);
  return bits.join(" · ");
}

function titleFor(q) {
  return q.sectionTitle || q.title || q.quizId || "Quiz";
}

function buildCard(q) {
  const quizId = q.quizId;
  const title = titleFor(q);
  const meta = formatMeta(q);

  const previewHref = `/pages/preview.html?quizId=${encodeURIComponent(quizId)}`;
  const quizHref = `/pages/quiz.html?quizId=${encodeURIComponent(quizId)}`;

  const card = document.createElement("div");
  card.className = "quiz-card";
  card.dataset.quizId = quizId;
  card.dataset.subject = q.subject || "";
  card.dataset.kind = q.kind || "";

  card.innerHTML = `
    <div class="quiz-title">${title}</div>
    <div class="quiz-meta">${meta || "&nbsp;"}</div>
    <div class="btn-row">
      <a class="pill-link" href="${previewHref}">Preview</a>
      <a class="pill-link secondary" href="${quizHref}">Start</a>
    </div>
  `;
  return card;
}

function toArrayFromRegistry(registry) {
  // Supports either:
  //  A) object keyed by quizId: { "math.circles": {...}, ... }
  //  B) array: [ {...}, {...} ]
  if (Array.isArray(registry)) return registry;

  if (registry && typeof registry === "object") {
    return Object.keys(registry).map((k) => {
      const v = registry[k] || {};
      // ensure quizId exists even if only keyed
      if (!v.quizId) v.quizId = k;
      return v;
    });
  }
  return [];
}

function isFullTest(q) {
  const k = norm(q.kind);
  if (k) return k === "fulltest";
  // fallback heuristic: modules
  const id = norm(q.quizId);
  return id.startsWith("test.") || id.includes("module");
}

function isTopic(q) {
  const k = norm(q.kind);
  if (k) return k === "topic";
  return !isFullTest(q);
}

function applyFilters(cards, { search, subject }) {
  const q = norm(search);
  const subj = norm(subject);

  cards.forEach((card) => {
    const title = norm(card.querySelector(".quiz-title")?.textContent);
    const meta = norm(card.querySelector(".quiz-meta")?.textContent);
    const quizId = norm(card.dataset.quizId);
    const cardSubj = norm(card.dataset.subject);

    const hitSearch =
      !q ||
      title.includes(q) ||
      meta.includes(q) ||
      quizId.includes(q);

    const hitSubject =
      !subj ||
      cardSubj === subj;

    card.style.display = hitSearch && hitSubject ? "" : "none";
  });
}

(async function initPracticePage() {
  const fullGrid = qs("fullTestsGrid");
  const topicGrid = qs("topicGrid");
  const searchEl = qs("qSearch");
  const subjectEl = qs("qSubject");

  if (!fullGrid || !topicGrid) {
    console.error("practicepage.js: missing #fullTestsGrid or #topicGrid in HTML.");
    return;
  }

  let registry;
  try {
    registry = await loadJson("/assets/configs/quizzes.json");
  } catch (e) {
    console.error("practicepage.js: failed to load quizzes registry", e);
    return;
  }

  const all = toArrayFromRegistry(registry)
    .filter((q) => q && (q.quizId || q.sectionId))
    .map((q) => {
      // normalize quizId
      if (!q.quizId) q.quizId = q.sectionId;
      // normalize subject if someone used "reading" etc.
      const s = norm(q.subject);
      if (!s && q.quizId) {
        const id = norm(q.quizId);
        if (id.startsWith("math.")) q.subject = "math";
        else if (id.startsWith("rw.") || id.startsWith("reading.") || id.startsWith("writing.")) q.subject = "rw";
      }
      // normalize kind if missing
      if (!q.kind) q.kind = isFullTest(q) ? "fulltest" : "topic";
      return q;
    });

  // Render
  fullGrid.innerHTML = "";
  topicGrid.innerHTML = "";

  const fullCards = [];
  const topicCards = [];

  all.forEach((q) => {
    const card = buildCard(q);
    if (isFullTest(q)) {
      fullCards.push(card);
      fullGrid.appendChild(card);
    } else {
      topicCards.push(card);
      topicGrid.appendChild(card);
    }
  });

  // Wire up filtering for topic section only (keep full tests always visible)
  const runFilter = () => {
    applyFilters(topicCards, {
      search: searchEl ? searchEl.value : "",
      subject: subjectEl ? subjectEl.value : ""
    });
  };

  if (searchEl) searchEl.addEventListener("input", runFilter);
  if (subjectEl) subjectEl.addEventListener("change", runFilter);

  // Initial filter (in case of prefilled inputs)
  runFilter();
})().catch((err) => console.error("practicepage.js init failed:", err));
