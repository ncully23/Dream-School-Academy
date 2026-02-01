// /assets/js/pages/practicepage.js
import { routes } from "/assets/js/lib/routes.js";

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id} on practice page`);
  return node;
}

function normalizeRegistry(registry) {
  // Support either { quizzes: [...] } or { [quizId]: {...} }
  if (!registry) return [];

  if (Array.isArray(registry.quizzes)) return registry.quizzes;

  // object-map form
  if (typeof registry === "object") {
    return Object.entries(registry).map(([quizId, v]) => ({
      quizId,
      ...v,
    }));
  }

  return [];
}

function matchesFilter(q, search, subject) {
  const s = (search || "").trim().toLowerCase();
  const subj = (subject || "").trim().toLowerCase();

  if (s) {
    const hay = [
      q.quizId,
      q.title,
      q.sectionTitle,
      q.subject,
      q.skill,
      q.topic,
      q.tags?.join(" "),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!hay.includes(s)) return false;
  }

  if (subj) {
    // Accept: "math", "rw", "reading", "writing", "reading & writing"
    const qSubj = String(q.subject || "").toLowerCase();
    if (subj === "math") return qSubj.includes("math");
    if (subj === "rw") return qSubj.includes("rw") || qSubj.includes("reading") || qSubj.includes("writing");
    return qSubj.includes(subj);
  }

  return true;
}

function formatMeta(q) {
  const parts = [];
  if (q.subjectLabel) parts.push(q.subjectLabel);
  else if (q.subject) parts.push(q.subject);

  if (q.questionCount) parts.push(`${q.questionCount} questions`);
  if (q.estimatedTime) parts.push(q.estimatedTime);
  else if (q.timeLimitSec) parts.push(`${Math.round(q.timeLimitSec / 60)} min`);

  if (q.difficulty) parts.push(q.difficulty);

  return parts.filter(Boolean).join(" · ");
}

function renderCard(container, q, kind = "topic") {
  const card = document.createElement("div");
  card.className = "quiz-card";

  const title = document.createElement("div");
  title.className = "quiz-title";
  title.textContent = q.title || q.sectionTitle || q.quizId;

  const meta = document.createElement("div");
  meta.className = "quiz-meta";
  meta.textContent = formatMeta(q) || (kind === "full" ? "Timed module" : "Practice quiz");

  const row = document.createElement("div");
  row.className = "btn-row";

  const preview = document.createElement("a");
  preview.className = "pill-link";
  preview.href = routes.preview(q.quizId);
  preview.textContent = "Preview";

  const start = document.createElement("a");
  start.className = "pill-link secondary";
  start.href = routes.quiz(q.quizId);
  start.textContent = "Start";

  row.appendChild(preview);
  row.appendChild(start);

  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(row);
  container.appendChild(card);
}

function partitionQuizzes(quizzes) {
  // You can drive this via quizzes.json with `kind: "full"` or `category: "full"`
  const full = [];
  const topic = [];

  quizzes.forEach((q) => {
    const kind = String(q.kind || q.category || "").toLowerCase();
    const isFull =
      kind.includes("full") ||
      kind.includes("module") ||
      q.isFullTest === true;

    (isFull ? full : topic).push(q);
  });

  // Stable ordering: full tests first by order, topics alpha by title
  full.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  topic.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));

  return { full, topic };
}

async function init() {
  const fullGrid = el("fullTestsGrid");
  const topicGrid = el("topicGrid");
  const searchEl = document.getElementById("qSearch");
  const subjectEl = document.getElementById("qSubject");

  const registryRaw = await loadJson("/assets/configs/quizzes.json");
  const quizzes = normalizeRegistry(registryRaw);

  const { full, topic } = partitionQuizzes(quizzes);

  function paint() {
    const search = searchEl ? searchEl.value : "";
    const subject = subjectEl ? subjectEl.value : "";

    fullGrid.innerHTML = "";
    topicGrid.innerHTML = "";

    full
      .filter((q) => matchesFilter(q, search, subject))
      .forEach((q) => renderCard(fullGrid, q, "full"));

    topic
      .filter((q) => matchesFilter(q, search, subject))
      .forEach((q) => renderCard(topicGrid, q, "topic"));
  }

  if (searchEl) searchEl.addEventListener("input", paint);
  if (subjectEl) subjectEl.addEventListener("change", paint);

  paint();
}

init().catch((err) => {
  console.error("practicepage.js failed:", err);
});
